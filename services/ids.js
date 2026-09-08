/**
 * Capaxero Cloud — Geração de Identificadores
 *
 * Os geradores antigos truncavam o epoch e colidiam em produção:
 *   transactions.id  "TX-"  + Date.now().slice(-6)  -> reaproveita o namespace a cada 16,7 min
 *   alerts.id        "ALT-" + Date.now().slice(-5)  -> reaproveita a cada 100 s
 *   depots.depotno   `DEP-${array.length + 1}`      -> repete um id já usado após qualquer exclusão
 *   branches.branno  `BR-${array.length + 1}`       -> idem
 *
 * O formato aqui é prefixo + timestamp em base36 + sufixo aleatório: continua legível e
 * ordenável por tempo para quem lê o painel, mas sem janela de colisão prática (são
 * 36^5 ≈ 60 milhões de sufixos por milissegundo).
 *
 * Ids antigos permanecem válidos — nada é reescrito. O schema aceita os dois formatos.
 */
const crypto = require('crypto');

const RANDOM_LEN = 5;

function randomSuffix(len = RANDOM_LEN) {
  // rejeita nada: base36 sobre bytes aleatórios é suficiente para desempate dentro do mesmo ms
  let out = '';
  const bytes = crypto.randomBytes(len);
  for (let i = 0; i < len; i++) {
    out += (bytes[i] % 36).toString(36);
  }
  return out.toUpperCase();
}

function prefixedId(prefix) {
  return `${prefix}-${Date.now().toString(36).toUpperCase()}-${randomSuffix()}`;
}

const newTransactionId = () => prefixedId('TX');
const newAlertId = () => prefixedId('ALT');
const newCommentId = () => prefixedId('CMT');
const newUserId = () => prefixedId('USR');
const newOrderId = () => prefixedId('ORD');

/**
 * UUID v4 para entidades que não precisam de prefixo legível (resgates de cupom).
 */
function newUuid() {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(16)}-${crypto.randomBytes(8).toString('hex')}`;
}

/**
 * Próximo id sequencial de uma série (DEP-1, DEP-2, ...) sem reaproveitar números.
 *
 * O gerador antigo usava `array.length + 1`, então excluir DEP-3 de uma lista de 5 fazia a
 * próxima inserção virar DEP-5 — colidindo com um depot existente. Aqui olhamos o maior
 * número já emitido, não a quantidade de linhas.
 */
function nextSequentialId(prefix, existingIds) {
  const pattern = new RegExp(`^${prefix}-0*(\\d+)$`);
  let max = 0;
  for (const id of existingIds || []) {
    const match = pattern.exec(String(id || ''));
    if (match) {
      const n = parseInt(match[1], 10);
      if (n > max) max = n;
    }
  }
  return `${prefix}-${max + 1}`;
}

module.exports = {
  newTransactionId,
  newAlertId,
  newCommentId,
  newUserId,
  newOrderId,
  newUuid,
  nextSequentialId,
  prefixedId
};
