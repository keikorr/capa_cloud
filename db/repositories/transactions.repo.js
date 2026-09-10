/**
 * Capaxero Cloud — Repositório de Histórico de Vendas por Máquina
 *
 * Primeiro repositório do projeto. Lê do Postgres — a foto congelada no momento da
 * importação (scripts/import_json.js), não o JSON ao vivo. Ver MIGRACAO.md e o plano de
 * migração para o porquê dessa escolha.
 *
 * Regra dura: nenhuma chamada a getPool()/query()/withTx() no escopo do módulo. Só dentro
 * das funções exportadas — é o que garante que require-ar este arquivo no topo de
 * routes/admin.js não quebre o boot do servidor quando DATABASE_URL não está configurada.
 */
const { withTx } = require('../pool');

const STATEMENT_TIMEOUT_MS = 5000;

const SQL_PAGE = `
  SELECT
    public_id,
    order_id,
    mode,
    mode_label,
    CASE WHEN payment_method = 'Cupom / Gratuidade' THEN 0 ELSE amount_cents END AS amount_cents,
    payment_method,
    card_brand,
    nsu,
    auth_code,
    occurred_at,
    -- ::text explícito: o driver pg converte DATE usando o fuso LOCAL do processo Node,
    -- não UTC — nesta máquina de desenvolvimento (UTC-3) o valor coincide com o certo, mas
    -- numa VPS com outro fuso a mesma data viraria outro dia. Devolver texto elimina a
    -- ambiguidade de vez, sem depender de configuração de type parser em db/pool.js.
    (occurred_at AT TIME ZONE 'America/Fortaleza')::date::text AS business_date
  FROM transactions
  WHERE devno = $1 AND status = 'APPROVED'
  ORDER BY occurred_at DESC, id DESC
  LIMIT $2 OFFSET $3
`;

// O total da página vem de summary.totals.tx_count (SQL_SUMMARY), não de um
// count(*) OVER() aqui. Motivo: count(*) OVER() só aparece nas linhas que sobrevivem ao
// LIMIT/OFFSET — se o offset pular todas as linhas da máquina, zero linhas voltam e o
// total desaparece junto (bug real, encontrado testando com offset além do fim). O
// tx_count do resumo é calculado sem LIMIT/OFFSET, então é sempre a verdade.

// AND status = 'APPROVED' escrito de forma literal (não parametrizada) é obrigatório para
// o planner casar o índice parcial transactions_devno_occurred_idx (devno, occurred_at DESC)
// WHERE status = 'APPROVED'. Parametrizar o status faria o Postgres considerar outros
// valores possíveis e abandonar o índice em silêncio.

const SQL_SUMMARY = `
  WITH base AS (
    SELECT mode, mode_label, CASE WHEN payment_method = 'Cupom / Gratuidade' THEN 0 ELSE amount_cents END AS amount_cents, payment_method, occurred_at, created_at
    FROM transactions
    WHERE devno = $1 AND status = 'APPROVED'
  ),
  totals AS (
    SELECT
      count(*)::bigint                                                    AS tx_count,
      coalesce(sum(amount_cents), 0)::bigint                              AS total_cents,
      coalesce(round(avg(amount_cents)), 0)::bigint                       AS avg_ticket_cents,
      min(occurred_at)                                                    AS first_sale_at,
      max(occurred_at)                                                    AS last_sale_at,
      count(DISTINCT (occurred_at AT TIME ZONE 'America/Fortaleza')::date) AS active_days
    FROM base
  ),
  by_mode AS (
    SELECT mode,
           max(mode_label)                       AS mode_label,
           count(*)::bigint                      AS tx_count,
           coalesce(sum(amount_cents), 0)::bigint AS total_cents
    FROM base GROUP BY mode
  ),
  by_payment AS (
    SELECT payment_method,
           count(*)::bigint                      AS tx_count,
           coalesce(sum(amount_cents), 0)::bigint AS total_cents
    FROM base GROUP BY payment_method
  )
  SELECT
    (SELECT row_to_json(t) FROM totals t)                                                    AS totals,
    coalesce((SELECT json_agg(m ORDER BY m.total_cents DESC) FROM by_mode m),    '[]'::json)  AS by_mode,
    coalesce((SELECT json_agg(p ORDER BY p.total_cents DESC) FROM by_payment p), '[]'::json)  AS by_payment,
    EXISTS (SELECT 1 FROM totems WHERE devno = $1)                                            AS machine_in_snapshot,
    -- Global, não por máquina: a importação inteira roda numa única transação, num único
    -- instante — "quando o arquivo foi congelado" é um fato da base inteira, não desta
    -- máquina. Escopar a devno quebrava numa máquina sem nenhuma venda (max() sobre
    -- conjunto vazio é NULL), que é justamente quando a data do arquivo mais importa
    -- mostrar, para dizer "esta máquina não tinha vendas até {data}".
    (SELECT max(created_at) FROM transactions)                                                AS imported_at
`;

// Agregado sobre conjunto vazio ainda devolve UMA linha com tx_count = 0 e datas NULL — é
// esse o sinal que distingue "conectado, máquina sem vendas" de qualquer estado de erro.
// machine_in_snapshot separa "máquina cadastrada depois do arquivo" de "existia e não
// vendeu nada"; sem isso os dois casos renderizam tabela vazia e parecem bug.

const SQL_COUPONS = `
  SELECT
    r.id,
    r.coupon_code,
    c.description AS coupon_description,
    r.cpf_formatted,
    r.redeemed_at,
    r.selected_mode,
    r.order_id,
    r.discount_percent,
    r.discount_applied_cents,
    count(*) OVER ()::int                    AS total_rows,
    coalesce(sum(r.discount_applied_cents) OVER (), 0)::bigint AS total_discount_cents
  FROM coupon_redemptions r
  JOIN coupons c ON c.code = r.coupon_code
  WHERE r.totem_devno = $1
  ORDER BY r.redeemed_at DESC
  LIMIT $2
`;

// r.cpf (11 dígitos crus) é deliberadamente omitido — cpf_formatted é tudo que a tela
// mostra, e não há motivo para colocar CPF sem máscara no fio numa tela de vendas.

function mapTransactionRow(row) {
  return {
    publicId: row.public_id,
    orderId: row.order_id,
    mode: row.mode,
    modeLabel: row.mode_label,
    amountCents: row.amount_cents,
    paymentMethod: row.payment_method,
    cardBrand: row.card_brand,
    nsu: row.nsu,
    authCode: row.auth_code,
    occurredAt: row.occurred_at,
    businessDate: row.business_date
  };
}

function mapRedemptionRow(row) {
  return {
    id: row.id,
    couponCode: row.coupon_code,
    couponDescription: row.coupon_description,
    cpfFormatted: row.cpf_formatted,
    redeemedAt: row.redeemed_at,
    selectedMode: row.selected_mode,
    orderId: row.order_id,
    discountPercent: row.discount_percent,
    discountAppliedCents: row.discount_applied_cents
  };
}

/**
 * Histórico de vendas de uma máquina: página de transações, resumo agregado (totais,
 * quebra por modalidade, quebra por forma de pagamento) e cupons resgatados nela — em uma
 * única transação, para compartilhar client e o statement_timeout local.
 *
 * limit é sempre clamped pelo chamador (rota) antes de chegar aqui; este módulo não valida
 * de novo por confiar no único ponto de entrada hoje.
 */
async function getMachineHistory(devno, { limit = 50, offset = 0, couponLimit = 100 } = {}) {
  return withTx(async (client) => {
    // SET LOCAL, não SET: dentro de uma transação não vaza para o próximo tomador do pool.
    await client.query(`SET LOCAL statement_timeout = ${STATEMENT_TIMEOUT_MS}`);

    // Sequencial, não Promise.all: um Client do pg processa uma query por vez na mesma
    // conexão — despachar as três concorrentemente no mesmo client é comportamento
    // depreciado (fila interna hoje, removida no pg v9), mesmo compartilhando uma
    // transação de propósito para o SET LOCAL acima valer para as três.
    const pageResult = await client.query(SQL_PAGE, [devno, limit, offset]);
    const summaryResult = await client.query(SQL_SUMMARY, [devno]);
    const couponsResult = await client.query(SQL_COUPONS, [devno, couponLimit]);

    const summaryRow = summaryResult.rows[0];
    const totals = summaryRow.totals || {};
    const txCount = Number(totals.tx_count || 0);

    return {
      machineInSnapshot: summaryRow.machine_in_snapshot === true,
      snapshot: {
        importedAt: summaryRow.imported_at || null,
        firstSaleAt: totals.first_sale_at || null,
        lastSaleAt: totals.last_sale_at || null
      },
      summary: {
        txCount,
        totalCents: Number(totals.total_cents || 0),
        avgTicketCents: Number(totals.avg_ticket_cents || 0),
        activeDays: Number(totals.active_days || 0)
      },
      byMode: (summaryRow.by_mode || []).map(m => ({
        mode: m.mode,
        modeLabel: m.mode_label,
        txCount: Number(m.tx_count || 0),
        totalCents: Number(m.total_cents || 0)
      })),
      byPayment: (summaryRow.by_payment || []).map(p => ({
        paymentMethod: p.payment_method,
        txCount: Number(p.tx_count || 0),
        totalCents: Number(p.total_cents || 0)
      })),
      page: {
        limit,
        offset,
        total: txCount
      },
      transactions: pageResult.rows.map(mapTransactionRow),
      coupons: {
        count: couponsResult.rows[0] ? Number(couponsResult.rows[0].total_rows) : 0,
        discountCents: couponsResult.rows[0] ? Number(couponsResult.rows[0].total_discount_cents) : 0,
        rows: couponsResult.rows.map(mapRedemptionRow)
      }
    };
  });
}

module.exports = { getMachineHistory };
