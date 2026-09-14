/**
 * Capaxero Cloud — Normalização de Modalidade de Higienização
 *
 * A modalidade chegava ao banco em pelo menos três grafias para o mesmo ciclo:
 *   - rotas do backend      -> 'INTERMEDIARIA'  (maiúsculo, sem acento)
 *   - APK / painel web      -> 'Intermediária'  (capitalizado, com acento)
 *   - simulador / logs      -> 'inter'          (abreviado)
 *
 * getStats() classificava contando as chaves { BASICA, INTERMEDIARIA, AVANCADA }, então
 * toda transação acentuada era simplesmente ignorada no gráfico de modalidades — o painel
 * mostrava menos ciclos por modalidade do que o total de vendas do dia.
 *
 * Este módulo é o único lugar do sistema que decide qual é a modalidade canônica.
 */

const MODES = ['BASICA', 'INTERMEDIARIA', 'AVANCADA'];

const LABELS = {
  BASICA: 'Básica',
  INTERMEDIARIA: 'Intermediária',
  AVANCADA: 'Avançada'
};

/**
 * Remove acentos e caixa para comparar grafias equivalentes.
 */
function fold(value) {
  return String(value == null ? '' : value)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toUpperCase();
}

/**
 * Converte qualquer grafia conhecida para a modalidade canônica.
 * Retorna null quando não reconhece — o chamador decide o fallback, para que um valor
 * inesperado apareça como tal em vez de virar silenciosamente 'INTERMEDIARIA'.
 */
function normalizeMode(raw) {
  const folded = fold(raw);
  if (!folded) return null;

  if (folded.startsWith('INTER')) return 'INTERMEDIARIA';
  if (folded.startsWith('BASIC')) return 'BASICA';
  if (folded.startsWith('AVANC') || folded.startsWith('ADVANC')) return 'AVANCADA';

  // Aliases usados no app e no simulador
  if (folded === 'MEDIO' || folded === 'MEDIA') return 'INTERMEDIARIA';
  if (folded === 'COMPLETA' || folded === 'PREMIUM' || folded === 'OZONIO') return 'AVANCADA';
  if (folded === 'RAPIDA' || folded === 'SIMPLES') return 'BASICA';

  return null;
}

/**
 * Rótulo de exibição a partir da modalidade canônica.
 */
function modeLabel(mode) {
  return LABELS[normalizeMode(mode)] || null;
}

/**
 * Garante uma modalidade válida, com fallback explícito para dados legados.
 */
function normalizeModeOrDefault(raw, fallback = 'INTERMEDIARIA') {
  return normalizeMode(raw) || fallback;
}

function isValidMode(mode) {
  return MODES.includes(mode);
}

/**
 * Infere a modalidade a partir do valor cobrado quando a grafia recebida não é reconhecida
 * (ou não veio). Usado como fallback antes de normalizeModeOrDefault: o valor da venda já
 * reflete o que o cliente pagou, então casar contra a tabela de preços do totem acerta a
 * modalidade real na maioria dos casos — bem melhor do que assumir Intermediária sempre.
 * modesPricesInCents: { basica, intermediaria, avancada } (aceita undefined por chave).
 */
function inferModeFromAmount(amountInCents, modesPricesInCents) {
  if (!amountInCents || !modesPricesInCents) return null;
  let closest = null;
  let closestDiff = Infinity;
  for (const mode of MODES) {
    const price = modesPricesInCents[mode.toLowerCase()];
    if (price == null) continue;
    const diff = Math.abs(price - amountInCents);
    if (diff < closestDiff) {
      closestDiff = diff;
      closest = mode;
    }
  }
  // Só aceita o mais próximo se bater em cima (tolerância de R$0,50) — um valor muito
  // distante de todas as três (ex.: cupom com desconto) não deve virar um palpite forçado.
  return closestDiff <= 50 ? closest : null;
}

module.exports = {
  MODES,
  LABELS,
  normalizeMode,
  normalizeModeOrDefault,
  modeLabel,
  isValidMode,
  inferModeFromAmount
};
