#!/usr/bin/env node
/**
 * Capaxero Cloud — Importação do banco JSON para PostgreSQL
 *
 * Lê um arquivo no formato de data/capaxero_database.json e popula um banco Postgres já
 * migrado (rode scripts/migrate.js antes). Roda inteiro dentro de uma transação: qualquer
 * falha desfaz tudo, nunca deixa o banco pela metade.
 *
 * Resolve três problemas de integridade já conhecidos nos dados reais de produção, em vez
 * de deixá-los quebrar a importação ou de escolher em silêncio qual registro descartar:
 *
 *   1) depotno duplicado — o antigo gerador de id (`DEP-${length+1}`) reaproveita um id
 *      depois de qualquer exclusão. Na produção, DEP-3 e DEP-12 existem em duplicata, cada
 *      par apontando para um PONTO FÍSICO DIFERENTE. Mantém o mais antigo (por createdAt)
 *      no id original e renomeia os demais com services/ids.js, que corrige exatamente
 *      esse defeito (fase 0). Isso é reportado, nunca silencioso.
 *
 *   2) DEP-01 como sentinela — dez totens apontam para um depotno que não existe na tabela
 *      de depots real. Vira NULL (totem sem ponto de instalação atribuído).
 *
 *   3) owner_id que não resolve para um usuário existente — cai no fallback por nome
 *      (totem.owner comparado a responsible_name/username), e na ausência de match vai
 *      para CRPADMIN, com o motivo reportado por totem.
 *
 *   4) depotna genérico — todos os 13 pontos de produção têm depotna = "Ponto de
 *      Instalação" (o placeholder), com o nome real só no campo `name` (chegou por um
 *      spread de cliente, nunca foi o campo pretendido). depotDisplayName() prefere o
 *      nome real quando depotna é só o placeholder.
 *
 *   5) id de transação/alerta colidido — os geradores antigos (corrigidos na fase 0,
 *      services/ids.js) podiam produzir o mesmo id para registros DIFERENTES. Nunca
 *      descarta: mantém o mais antigo no id original e cunha um id novo para o resto.
 *
 * Dedupe de transações: a importação usa ON CONFLICT DO NOTHING na mesma constraint
 * UNIQUE(order_id, devno) WHERE status='APPROVED' que impede duplicata no dia a dia —
 * inserindo em ordem cronológica, a linha mais antiga de cada pedido "vence" e as
 * demais são descartadas na própria carga, sem precisar de uma segunda passada.
 *
 * Uso:
 *   node scripts/import_json.js <caminho.json>              simula, não grava nada
 *   node scripts/import_json.js <caminho.json> --apply       aplica de fato
 *
 * Requer DATABASE_URL no ambiente ou no .env, e o schema já migrado.
 *
 * É carga única, não sincronização: espera um banco Postgres VAZIO (só com o schema
 * aplicado). Rodar contra um banco já populado falha com violação de chave primária na
 * primeira tabela — de propósito, e sem deixar resíduo (tudo roda dentro de uma única
 * transação, que desfaz por completo em qualquer erro). Se precisar reimportar, recrie o
 * banco ou trunque as tabelas manualmente antes.
 */
require('../config/env');

const fs = require('fs');
const path = require('path');
const { withClient } = require('../db/pool');
const pool = require('../db/pool');
const ids = require('../services/ids');
const { normalizeModeOrDefault, modeLabel, isValidMode } = require('../services/modes');

const APPLY = process.argv.includes('--apply');
const inputPath = process.argv[2] && !process.argv[2].startsWith('--')
  ? process.argv[2]
  : path.join(__dirname, '..', 'data', 'capaxero_database.json');

const SEVERITY_VALUES = new Set(['WARNING', 'CRITICAL']);
const DEPOTNA_GENERICO = 'Ponto de Instalação';

function toCents(reais) {
  return Math.round(Number(reais || 0) * 100);
}

/**
 * Nome de exibição do ponto. depotna é o campo "oficial" no JSON, mas TODOS os 13 pontos
 * de produção ficaram com o valor padrão genérico nele — o nome real ("Merit Offices &
 * Mall", "Parque São José" etc.) só existe no campo `name`, que chegou por um spread de
 * cliente e nunca foi o campo pretendido. Preferir depotna só quando não for o placeholder.
 */
function depotDisplayName(d) {
  if (d.depotna && d.depotna !== DEPOTNA_GENERICO) return d.depotna;
  if (d.name && d.name !== DEPOTNA_GENERICO) return d.name;
  return d.depotna || DEPOTNA_GENERICO;
}

/**
 * Resolve colisões de depotno mantendo o mais antigo no id original e renomeando os
 * demais. Retorna { depots: [...renomeados], renames: Map<idAntigo+idx, idNovo> } — o
 * "idAntigo+idx" é só para relatório, já que o id antigo é ambíguo entre os duplicados.
 */
function resolveDepotCollisions(depots) {
  const porId = new Map();
  for (const d of depots) {
    if (!porId.has(d.depotno)) porId.set(d.depotno, []);
    porId.get(d.depotno).push(d);
  }

  const resolved = [];
  const renameLog = [];
  const todosIds = new Set(depots.map(d => d.depotno));

  for (const [depotno, grupo] of porId) {
    if (grupo.length === 1) {
      resolved.push(grupo[0]);
      continue;
    }
    // Mais antigo primeiro, mantém o id original
    grupo.sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
    resolved.push(grupo[0]);
    for (let i = 1; i < grupo.length; i++) {
      const novoId = ids.nextSequentialId('DEP', [...todosIds]);
      todosIds.add(novoId);
      renameLog.push({
        depotnoOriginal: depotno,
        depotnoNovo: novoId,
        nome: grupo[i].name || grupo[i].depotna,
        endereco: grupo[i].address
      });
      resolved.push({ ...grupo[i], depotno: novoId });
    }
  }

  return { depots: resolved, renameLog };
}

/**
 * Resolve colisões de id legado numa lista de registros com campo `id` e `timestamp`
 * (transações e alertas — ambos tinham gerador de id capaz de colidir, corrigido na
 * fase 0, mas o histórico anterior à correção ainda carrega colisões reais: registros
 * DIFERENTES que ganharam o mesmo id porque o gerador reaproveitava o namespace a cada
 * poucos minutos ou segundos). Mantém o mais antigo no id original — nunca descarta um
 * registro, só cunha um id novo para o(s) que colidiram.
 *
 * Retorna Map<objeto, idResolvido> (por referência, não por id antigo, que é ambíguo).
 */
function resolveIdCollisions(registros, mintFn) {
  const porId = new Map();
  for (const r of registros) {
    if (!porId.has(r.id)) porId.set(r.id, []);
    porId.get(r.id).push(r);
  }

  const resolvedIdByRecord = new Map();
  const renameLog = [];

  for (const [idOriginal, grupo] of porId) {
    if (grupo.length === 1) {
      resolvedIdByRecord.set(grupo[0], idOriginal);
      continue;
    }
    grupo.sort((a, b) => new Date(a.timestamp || 0) - new Date(b.timestamp || 0));
    resolvedIdByRecord.set(grupo[0], idOriginal);
    for (let i = 1; i < grupo.length; i++) {
      const novoId = mintFn();
      resolvedIdByRecord.set(grupo[i], novoId);
      renameLog.push({ idOriginal, idNovo: novoId, devno: grupo[i].devno, timestamp: grupo[i].timestamp });
    }
  }

  return { resolvedIdByRecord, renameLog };
}

/**
 * Resolve o dono de um totem: owner_id direto se existir na tabela de usuários; senão
 * tenta casar pelo nome (o fallback de 3 vias que o RBAC usa hoje); senão CRPADMIN.
 * Retorna { ownerId, motivo } — motivo é null quando owner_id já resolvia direto.
 */
function resolveOwnerId(totem, usersById, crpadminId) {
  if (totem.owner_id && usersById.has(totem.owner_id)) {
    return { ownerId: totem.owner_id, motivo: null };
  }

  if (totem.owner) {
    for (const u of usersById.values()) {
      if (u.responsible_name === totem.owner || u.username === totem.owner) {
        return { ownerId: u.id, motivo: `owner_id "${totem.owner_id}" não existe; casado por nome ("${totem.owner}")` };
      }
    }
  }

  return { ownerId: crpadminId, motivo: `owner_id "${totem.owner_id}" não existe e nome "${totem.owner}" não casou com nenhum usuário; caiu para CRPADMIN` };
}

async function main() {
  if (!fs.existsSync(inputPath)) {
    console.error(`Arquivo não encontrado: ${inputPath}`);
    process.exit(1);
  }

  const db = JSON.parse(fs.readFileSync(inputPath, 'utf-8'));
  console.log(`Lendo ${inputPath}`);
  console.log(`  usuários ${db.users.length} | totens ${db.totems.length} | depots ${db.depots.length} | ` +
    `branches ${(db.branches || []).length} | transações ${db.transactions.length} | ` +
    `alertas ${db.alerts.length} | cupons ${db.coupons.length}`);
  console.log(APPLY ? '\nMODO: aplicando de verdade\n' : '\nMODO: simulação (--apply para gravar)\n');

  const relatorio = { avisos: [], resumo: {} };

  await withClient(async (client) => {
    if (APPLY) await client.query('BEGIN');

    // ── BRANCHES ──────────────────────────────────────────────────────────
    // O array vem vazio na produção, mas totems/depots referenciam "BR-01" por padrão.
    // Sintetiza as branches referenciadas e ausentes, para a FK não quebrar.
    const brannosReferenciados = new Set([
      ...db.totems.map(t => t.branno).filter(Boolean),
      ...db.depots.map(d => d.branno).filter(Boolean)
    ]);
    const branchesExplicitas = db.branches || [];
    const brannosExplicitos = new Set(branchesExplicitas.map(b => b.branno));
    const brannosSinteticos = [...brannosReferenciados].filter(b => !brannosExplicitos.has(b));

    if (brannosSinteticos.length) {
      relatorio.avisos.push(`branches sintetizadas (não existiam no JSON, só referenciadas): ${brannosSinteticos.join(', ')}`);
    }

    for (const b of branchesExplicitas) {
      if (APPLY) {
        await client.query(
          `INSERT INTO branches (branno, branna, cocode, compno, manager, phone, active, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [b.branno, b.branna || 'Filial Regional', b.cocode || 'CAPAXERO', b.compno || '87550094',
            b.manager || null, b.phone || null, b.active !== false, b.createdAt || new Date().toISOString()]
        );
      }
    }
    for (const branno of brannosSinteticos) {
      if (APPLY) {
        await client.query(`INSERT INTO branches (branno) VALUES ($1)`, [branno]);
      }
    }
    relatorio.resumo.branches = branchesExplicitas.length + brannosSinteticos.length;

    // ── USERS ─────────────────────────────────────────────────────────────
    for (const u of db.users) {
      if (APPLY) {
        await client.query(
          `INSERT INTO users (id, username, email, password_hash, role, cnpj, responsible_name,
                               phone, company_name, franchise_type, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [u.id, u.username, u.email, u.password_hash, u.role, u.cnpj || null, u.responsible_name,
            u.phone || null, u.company_name || null, u.franchiseType || null,
            u.created_at || new Date().toISOString(), u.updated_at || u.created_at || new Date().toISOString()]
        );
      }
    }
    relatorio.resumo.users = db.users.length;

    const usersById = new Map(db.users.map(u => [u.id, u]));
    const crpadmin = db.users.find(u => u.role === 'CRPADMIN');
    if (!crpadmin) throw new Error('Nenhum usuário CRPADMIN encontrado — abortando importação.');

    // ── DEPOTS (com resolução de colisão de depotno) ────────────────────────
    const { depots: depotsResolvidos, renameLog } = resolveDepotCollisions(db.depots);
    for (const r of renameLog) {
      relatorio.avisos.push(
        `depotno duplicado: "${r.depotnoOriginal}" tinha 2+ pontos diferentes; ` +
        `"${r.nome}" (${r.endereco}) renomeado para "${r.depotnoNovo}"`
      );
    }

    for (const d of depotsResolvidos) {
      if (APPLY) {
        await client.query(
          `INSERT INTO depots (depotno, depotna, branno, address, contact_person, phone,
                                daily_traffic_motos, commission_percent, lat, lng, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [d.depotno, depotDisplayName(d),
            brannosReferenciados.has(d.branno) || brannosExplicitos.has(d.branno) ? d.branno : null,
            d.address || '', d.contactPerson || '', d.phone || '',
            Number(d.dailyTrafficMotos || 0), Number(d.commissionPercent || 0),
            d.lat != null ? d.lat : null, d.lng != null ? d.lng : null,
            d.createdAt || new Date().toISOString()]
        );
      }
    }
    relatorio.resumo.depots = depotsResolvidos.length;

    // Depotno "órfão": totem aponta para um id que não sobra em nenhum depot resolvido e
    // não é o sentinela conhecido (DEP-01). Isso cobriria, por exemplo, um totem que
    // apontasse justamente para o duplicado que FOI renomeado — nesta base isso não
    // acontece (nenhum dos duplicados tinha devno preenchido), mas o script confere de
    // verdade em vez de assumir.
    const depotnosValidos = new Set(depotsResolvidos.map(d => d.depotno));
    const totemsOrfaos = db.totems.filter(t =>
      t.depotno && t.depotno !== 'DEP-01' && !depotnosValidos.has(t.depotno)
    );
    if (totemsOrfaos.length) {
      relatorio.avisos.push(
        `ATENÇÃO: ${totemsOrfaos.length} totem(ns) apontam para um depotno inexistente ` +
        `(além do sentinela DEP-01) — confira manualmente: ${totemsOrfaos.map(t => `${t.devno}->${t.depotno}`).join(', ')}`
      );
    }

    // ── TOTEMS ────────────────────────────────────────────────────────────
    let depotSentinelas = 0;
    let ownersResolvidosPorNome = 0;
    for (const t of db.totems) {
      const { ownerId, motivo } = resolveOwnerId(t, usersById, crpadmin.id);
      if (motivo) {
        relatorio.avisos.push(`totem ${t.devno}: ${motivo}`);
        ownersResolvidosPorNome++;
      }

      let depotno = t.depotno && depotnosValidos.has(t.depotno) ? t.depotno : null;
      if (t.depotno && !depotno) depotSentinelas++;

      if (APPLY) {
        await client.query(
          `INSERT INTO totems (devno, name, location, depotno, branno, owner_id, box_count,
                                status, liquid_level_percent, door_locked, last_heartbeat,
                                current_cycle, config, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14)`,
          [t.devno, t.name || `Totem #${t.devno}`, t.location || 'Ponto a Cadastrar',
            depotno, brannosReferenciados.has(t.branno) ? t.branno : null, ownerId,
            Number(t.boxCount || 1), t.status || 'IDLE',
            t.liquidLevelPercent != null ? t.liquidLevelPercent : 100,
            t.doorLocked !== false, t.lastHeartbeat || null,
            t.currentCycle ? JSON.stringify(t.currentCycle) : null,
            JSON.stringify(configSemCredenciais(t.config || {})),
            t.lastHeartbeat || new Date().toISOString()]
        );

        const cielo = (t.config || {}).cielo || {};
        await client.query(
          `INSERT INTO totem_payment_credentials
             (devno, pinpad_license, pinpad_company, pinpad_comm, conecta_environment,
              conecta_client_id, conecta_client_secret, conecta_subordinated_merchant_id,
              conecta_terminal_id, conecta_card_timeout_seconds, ecommerce_environment,
              ecommerce_merchant_id, ecommerce_merchant_key, pix_expiration_seconds, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
          [t.devno, cielo.pinpadLicense || '', cielo.pinpadCompany || '', cielo.pinpadComm || 'USB',
            cielo.conectaEnvironment || 'Sandbox', cielo.conectaClientId || '', cielo.conectaClientSecret || '',
            cielo.conectaSubordinatedMerchantId || '', cielo.conectaTerminalId || '',
            Number(cielo.conectaCardTimeoutSeconds || 90), cielo.ecommerceEnvironment || 'Producao',
            cielo.ecommerceMerchantId || '', cielo.ecommerceMerchantKey || '',
            Number(cielo.pixExpirationSeconds || 180), cielo.updatedAt || new Date().toISOString()]
        );
      }
    }
    relatorio.resumo.totems = db.totems.length;
    relatorio.resumo.totems_depot_sentinela_para_null = depotSentinelas;
    relatorio.resumo.totems_owner_resolvido_por_nome = ownersResolvidosPorNome;

    // ── TRANSACTIONS ──────────────────────────────────────────────────────
    // Ordem cronológica ascendente: em caso de conflito (order_id, devno) já aprovado,
    // ON CONFLICT DO NOTHING descarta o mais recente — a mesma regra do
    // scripts/dedupe_transactions.js, aplicada durante a própria carga.
    const { resolvedIdByRecord: txIdResolvido, renameLog: txRenameLog } =
      resolveIdCollisions(db.transactions, ids.newTransactionId);
    if (txRenameLog.length) {
      relatorio.avisos.push(
        `id de transação colidido (gerador antigo, corrigido na fase 0): ${txRenameLog.length} registro(s) ` +
        `receberam id novo — ${txRenameLog.map(r => `"${r.idOriginal}"->"${r.idNovo}"`).join(', ')}`
      );
    }

    const txsOrdenadas = [...db.transactions].sort((a, b) =>
      new Date(a.timestamp || 0) - new Date(b.timestamp || 0)
    );
    let txsDescartadasPorDuplicata = 0;
    let modosInvalidos = 0;
    const chavesVistas = new Set();
    for (const t of txsOrdenadas) {
      const modoNormalizado = normalizeModeOrDefault(t.mode);
      if (!t.mode || modeLabel(t.mode) === null) modosInvalidos++;

      // Mesma regra do ON CONFLICT abaixo, calculada em JS: permite reportar quantas
      // duplicatas serão descartadas mesmo em modo simulação, sem tocar no banco.
      const chave = `${t.orderId}|${t.devno}`;
      const status = t.status || 'APPROVED';
      const jaVista = status === 'APPROVED' && chavesVistas.has(chave);
      if (status === 'APPROVED') chavesVistas.add(chave);
      if (jaVista) txsDescartadasPorDuplicata++;

      if (APPLY) {
        const result = await client.query(
          `INSERT INTO transactions (public_id, order_id, devno, status, mode, mode_label,
                                      amount_cents, payment_method, card_brand, nsu, auth_code,
                                      occurred_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
           ON CONFLICT (order_id, devno) WHERE status = 'APPROVED' DO NOTHING
           RETURNING id`,
          [txIdResolvido.get(t), t.orderId, t.devno, status, modoNormalizado,
            modeLabel(t.mode) || t.mode || null, toCents(t.amount), t.paymentMethod || 'DESCONHECIDO',
            t.cardBrand || null, t.nsu || null, t.authCode || null,
            t.timestamp || new Date().toISOString()]
        );
        // Confirma que a contagem em JS bateu com a decisão real do banco
        if ((result.rowCount === 0) !== jaVista) {
          throw new Error(
            `Divergência entre a previsão de duplicata em JS e o resultado do banco para ` +
            `orderId=${t.orderId} devno=${t.devno} — abortando import para investigação.`
          );
        }
      }
    }
    relatorio.resumo.transactions = db.transactions.length;
    relatorio.resumo.transactions_descartadas_por_duplicata = txsDescartadasPorDuplicata;
    relatorio.resumo.transactions_modo_invalido_ou_ausente = modosInvalidos;

    // ── ALERTS + ALERT_COMMENTS ──────────────────────────────────────────
    const { resolvedIdByRecord: alertIdResolvido, renameLog: alertRenameLog } =
      resolveIdCollisions(db.alerts, ids.newAlertId);
    if (alertRenameLog.length) {
      relatorio.avisos.push(
        `id de alerta colidido (gerador antigo, corrigido na fase 0): ${alertRenameLog.length} registro(s) ` +
        `receberam id novo — ${alertRenameLog.map(r => `"${r.idOriginal}"->"${r.idNovo}" (${r.devno}, ${r.timestamp})`).join('; ')}`
      );
    }

    let severityCorrigida = 0;
    for (const a of db.alerts) {
      // A tabela já separa severity/priority; o defeito real é que openMaintenanceOrder
      // grava a prioridade DENTRO de severity também. Se severity não é WARNING/CRITICAL,
      // é essa duplicata indevida — vira NULL, e priority (já correto) é preservado.
      let severity = a.severity;
      if (severity && !SEVERITY_VALUES.has(String(severity).toUpperCase())) {
        severity = null;
        severityCorrigida++;
      } else if (severity) {
        severity = String(severity).toUpperCase();
      }

      if (APPLY) {
        const result = await client.query(
          `INSERT INTO alerts (public_id, devno, type, severity, priority, issue_type,
                                assignee, message, resolved, resolved_at, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
           RETURNING id`,
          [alertIdResolvido.get(a), a.devno, a.type || 'ALERTA', severity, a.priority || null, a.issueType || null,
            a.assignee || null, a.message || '', a.resolved === true, a.resolvedAt || null,
            a.timestamp || new Date().toISOString()]
        );
        const alertId = result.rows[0].id;
        for (const c of (a.comments || [])) {
          await client.query(
            `INSERT INTO alert_comments (public_id, alert_id, text, author, created_at)
             VALUES ($1,$2,$3,$4,$5)`,
            [c.id, alertId, c.text, c.author || 'Admin', c.timestamp || new Date().toISOString()]
          );
        }
      }
    }
    relatorio.resumo.alerts = db.alerts.length;
    relatorio.resumo.alerts_severity_corrigida = severityCorrigida;

    // ── COUPONS + COUPON_REDEMPTIONS ─────────────────────────────────────
    for (const c of db.coupons) {
      if (APPLY) {
        await client.query(
          `INSERT INTO coupons (code, description, discount_percent, applicable_mode,
                                 allowed_totems, max_usages, max_usages_per_cpf, require_cpf,
                                 current_usages, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [c.code, c.description || '', c.discountPercent || 10,
            c.applicableMode ? normalizeModeOrDefault(c.applicableMode) : null,
            c.allowedTotems && c.allowedTotems.length ? c.allowedTotems : null,
            c.maxUsages || 1, c.maxUsagesPerCpf || 1, c.requireCpf !== false,
            c.currentUsages || 0, c.createdAt || new Date().toISOString(),
            c.updatedAt || c.createdAt || new Date().toISOString()]
        );
        for (const r of (c.redemptions || [])) {
          await client.query(
            `INSERT INTO coupon_redemptions (id, coupon_code, cpf, cpf_formatted, redeemed_at,
                                              totem_devno, selected_mode, order_id,
                                              discount_percent, discount_applied_cents)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
            [r.id, c.code, r.cpf || null, r.cpfFormatted || null,
              r.redeemedAt || new Date().toISOString(), r.totemId || null,
              r.selectedMode ? normalizeModeOrDefault(r.selectedMode) : null, r.orderId || null,
              r.discountPercent || c.discountPercent || 0, r.discountAppliedInCents || 0]
          );
        }
      }
    }
    relatorio.resumo.coupons = db.coupons.length;
    relatorio.resumo.coupon_redemptions = db.coupons.reduce((acc, c) => acc + (c.redemptions || []).length, 0);

    // ── SYSTEM_SETTINGS ───────────────────────────────────────────────────
    if (APPLY && db.systemSettings) {
      await client.query(
        `UPDATE system_settings
         SET default_cielo_merchant_id = $1, default_cielo_merchant_key = $2, updated_at = now()
         WHERE id = 1`,
        [db.systemSettings.defaultCieloMerchantId || '', db.systemSettings.defaultCieloMerchantKey || '']
      );
    }

    if (APPLY) await client.query('COMMIT');
  });

  console.log('\n═══ Resumo ═══');
  for (const [k, v] of Object.entries(relatorio.resumo)) {
    console.log(`  ${k}: ${v}`);
  }
  if (relatorio.avisos.length) {
    console.log(`\n═══ Avisos (${relatorio.avisos.length}) ═══`);
    relatorio.avisos.forEach(a => console.log(`  - ${a}`));
  }
  console.log(APPLY ? '\nImportação aplicada.' : '\nSimulação — nada foi gravado. Rode com --apply para persistir.');
}

/**
 * Remove o bloco de credenciais Cielo do config antes de gravar em totems.config — elas
 * vão para totem_payment_credentials, para que o controle de acesso seja "não dar SELECT
 * na tabela" em vez de apagar campos de um objeto já carregado.
 */
function configSemCredenciais(config) {
  const { cielo, cieloMerchantId, cieloMerchantKey, ...resto } = config;
  return resto;
}

main()
  .catch(err => {
    console.error('\nFalhou:', err.message);
    console.error(err.stack);
    process.exitCode = 1;
  })
  .finally(() => pool.close());
