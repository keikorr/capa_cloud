/**
 * Golden snapshots — rede de segurança de regressão da migração para Postgres.
 *
 * Sobe o servidor sobre uma cópia descartável da fixture, bate em todas as rotas de
 * leitura como CRPADMIN e como OWNER, mascara os campos voláteis e compara o resultado
 * com o que está gravado em tests/golden/.
 *
 * Este é o artefato mais importante do plano de migração: a conversão para async e a
 * troca do datastore devem ser transparentes para a API, e é isto que prova.
 *
 * Uso:
 *   node tests/golden.js --update    grava/atualiza os snapshots
 *   node tests/golden.js             compara e sai com código 1 em qualquer diferença
 */
require('../config/env');

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const FIXTURE = path.join(ROOT, 'data', 'fixture_prod.json');
const GOLDEN_DIR = path.join(__dirname, 'golden');
const PORT = Number(process.env.GOLDEN_PORT || 3990);
const BASE = `http://localhost:${PORT}`;
const UPDATE = process.argv.includes('--update');
const SENHA_FIXTURE = process.env.CAPAXERO_FIXTURE_SENHA || 'fixture123';
// Senha que seedDefaultUsers() reaplica ao CRPADMIN em todo boot. Fallback apenas;
// deve deixar de ser necessária quando o seed hardcoded for removido.
const SENHA_SEED_ADMIN = process.env.CAPAXERO_SEED_SENHA || '210602';

// Campos cujo valor muda a cada execução e que não devem participar da comparação.
const VOLATILE_KEYS = new Set([
  'timestamp', 'serverTime', 'lastHeartbeat', 'createdAt', 'created_at',
  'updatedAt', 'updated_at', 'redeemedAt', 'usedAt', 'resolvedAt',
  'authorizedAt', 'expiresAt', 'token', 'currentCycle', 'elapsedSeconds',
  'progressPercent', 'revenueToday', 'cyclesToday', 'totalCyclesToday'
]);

// Campos secretos que nunca podem ser gravados em claro — estes snapshots vão para o git.
const SECRET_KEYS = new Set([
  'password_hash', 'secretkey',
  'cieloMerchantId', 'cieloMerchantKey',
  'ecommerceMerchantId', 'ecommerceMerchantKey',
  'conectaClientId', 'conectaClientSecret',
  'conectaSubordinatedMerchantId', 'conectaTerminalId',
  'pinpadLicense', 'pinpadCompany',
  'defaultCieloMerchantId', 'defaultCieloMerchantKey'
]);

/**
 * Assinatura de um segredo: preserva o sinal de regressão do RBAC (o painel mascara as
 * credenciais para quem não é CRPADMIN) sem gravar o valor. Se o mascaramento parar de
 * funcionar, a assinatura muda de "mascarado" para "aberto" e o teste acusa.
 */
function secretSignature(value) {
  if (value === null || value === undefined) return '<segredo:ausente>';
  const s = String(value);
  if (s === '') return '<segredo:vazio>';
  if (s.includes('****')) return `<segredo:mascarado:len=${s.length}>`;
  return `<segredo:aberto:len=${s.length}>`;
}

/**
 * Substitui valores voláteis por um marcador estável e ordena as chaves, para que o
 * snapshot só mude quando o conteúdo semântico mudar.
 */
function canonical(value, key) {
  if (Array.isArray(value)) return value.map(v => canonical(v));
  if (value && typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value).sort()) {
      if (SECRET_KEYS.has(k)) out[k] = secretSignature(value[k]);
      else if (VOLATILE_KEYS.has(k)) out[k] = '<volatil>';
      else out[k] = canonical(value[k], k);
    }
    return out;
  }
  if (key && SECRET_KEYS.has(key)) return secretSignature(value);
  if (key && VOLATILE_KEYS.has(key)) return '<volatil>';
  // Ids gerados em tempo de execução carregam timestamp; mascara o miolo
  if (typeof value === 'string' && /^(TX|ALT|CMT|USR|ORD)-[0-9A-Z]{8,}-[0-9A-Z]{5}$/.test(value)) {
    return value.replace(/-[0-9A-Z]{8,}-[0-9A-Z]{5}$/, '-<gerado>');
  }
  return value;
}

async function login(loginId, senha) {
  const res = await fetch(`${BASE}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: loginId, password: senha })
  });
  const body = await res.json();
  return body.success ? body.data.token : null;
}

async function capture(name, pathname, token) {
  const res = await fetch(`${BASE}${pathname}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {}
  });
  let body;
  try {
    body = await res.json();
  } catch (_) {
    body = { _naoJson: true };
  }
  return { name, status: res.status, body: canonical(body) };
}

function waitForServer(timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tick = async () => {
      try {
        const res = await fetch(`${BASE}/health`);
        if (res.ok) return resolve();
      } catch (_) { /* ainda subindo */ }
      if (Date.now() > deadline) return reject(new Error('servidor não subiu a tempo'));
      setTimeout(tick, 250);
    };
    tick();
  });
}

async function main() {
  if (!fs.existsSync(FIXTURE)) {
    console.error(`Fixture ausente: ${FIXTURE}`);
    console.error('Gere com: CAPAXERO_LOGIN=... CAPAXERO_SENHA=... node scripts/fetch_prod_dataset.js');
    process.exit(1);
  }

  // Cópia descartável: o servidor reescreve o banco no boot e a cada mutação
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'capaxero-golden-'));
  const tmpDb = path.join(tmpDir, 'db.json');
  fs.copyFileSync(FIXTURE, tmpDb);

  const server = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    env: { ...process.env, PORT: String(PORT), CAPAXERO_DB_FILE: tmpDb },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let serverLog = '';
  server.stdout.on('data', d => { serverLog += d; });
  server.stderr.on('data', d => { serverLog += d; });

  let falhas = 0;
  try {
    await waitForServer();

    // seedDefaultUsers() reescreve a senha do CRPADMIN para o valor semeado a cada boot
    // (database.js:192-194), sobrescrevendo o hash da fixture. Tenta a senha da fixture
    // primeiro para que este teste continue funcionando quando esse seed for removido.
    const admToken = await login('CRPADMIN', SENHA_FIXTURE)
      || await login('CRPADMIN', SENHA_SEED_ADMIN);
    if (!admToken) throw new Error('login CRPADMIN falhou na fixture e com a senha semeada');

    // Um OWNER da fixture, para exercitar o caminho de RBAC
    const usuarios = JSON.parse(fs.readFileSync(FIXTURE, 'utf-8')).users;
    const owner = usuarios.find(u => u.role !== 'CRPADMIN');
    const ownerToken = owner ? await login(owner.email, SENHA_FIXTURE) : null;

    const rotas = [
      ['health', '/health', null],
      ['coupons_publico', '/api/v1/coupons', null],
      ['admin_totems__crpadmin', '/api/v1/admin/totems', admToken],
      ['admin_depots__crpadmin', '/api/v1/admin/depots', admToken],
      ['admin_users__crpadmin', '/api/v1/admin/users', admToken],
      ['admin_alerts__crpadmin', '/api/v1/admin/alerts', admToken],
      ['admin_alerts_ativos__crpadmin', '/api/v1/admin/alerts?active=true', admToken],
      ['admin_transactions__crpadmin', '/api/v1/admin/transactions?limit=5000', admToken],
      ['admin_stats__crpadmin', '/api/v1/admin/stats', admToken],
      ['admin_income__crpadmin', '/api/v1/admin/income-report', admToken],
      ['auth_me__crpadmin', '/api/v1/auth/me', admToken]
    ];

    if (ownerToken) {
      rotas.push(
        ['admin_totems__owner', '/api/v1/admin/totems', ownerToken],
        ['admin_depots__owner', '/api/v1/admin/depots', ownerToken],
        ['admin_alerts__owner', '/api/v1/admin/alerts', ownerToken],
        ['admin_transactions__owner', '/api/v1/admin/transactions?limit=5000', ownerToken],
        ['admin_stats__owner', '/api/v1/admin/stats', ownerToken],
        ['admin_income__owner', '/api/v1/admin/income-report', ownerToken],
        ['auth_me__owner', '/api/v1/auth/me', ownerToken]
      );
    } else {
      console.warn('AVISO: nenhum usuário OWNER na fixture — caminho de RBAC não coberto.');
    }

    if (!fs.existsSync(GOLDEN_DIR)) fs.mkdirSync(GOLDEN_DIR, { recursive: true });

    for (const [name, pathname, token] of rotas) {
      const snap = await capture(name, pathname, token);
      const file = path.join(GOLDEN_DIR, `${name}.json`);
      const serializado = JSON.stringify(snap, null, 2);

      if (UPDATE) {
        fs.writeFileSync(file, serializado, 'utf-8');
        const tamanho = Array.isArray(snap.body?.data) ? ` (${snap.body.data.length} itens)` : '';
        console.log(`  gravado  ${name}  HTTP ${snap.status}${tamanho}`);
        continue;
      }

      if (!fs.existsSync(file)) {
        console.error(`  AUSENTE  ${name} — rode com --update`);
        falhas++;
        continue;
      }

      const esperado = fs.readFileSync(file, 'utf-8');
      if (esperado === serializado) {
        console.log(`  ok       ${name}`);
      } else {
        console.error(`  DIFERE   ${name}`);
        const a = JSON.parse(esperado);
        if (a.status !== snap.status) {
          console.error(`     status: esperado ${a.status}, obtido ${snap.status}`);
        }
        const ea = Array.isArray(a.body?.data) ? a.body.data.length : null;
        const eb = Array.isArray(snap.body?.data) ? snap.body.data.length : null;
        if (ea !== null && ea !== eb) {
          console.error(`     itens em data: esperado ${ea}, obtido ${eb}`);
        }
        falhas++;
      }
    }
  } catch (err) {
    console.error('Falha na execução:', err.message);
    if (serverLog) console.error('--- log do servidor ---\n' + serverLog.slice(-2000));
    falhas++;
  } finally {
    server.kill();
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) { /* melhor esforço */ }
  }

  // Falha de execução (servidor não subiu, login recusado) precisa derrubar o processo
  // mesmo em modo --update — senão o script "passa" sem ter capturado nada, que é
  // exatamente o defeito dos scripts de teste antigos deste projeto.
  if (falhas) {
    console.error(`\n${falhas} falha(s).`);
    process.exit(1);
  }
  console.log(UPDATE ? '\nSnapshots atualizados.' : '\nTodos os snapshots conferem.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
