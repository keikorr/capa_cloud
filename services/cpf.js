/**
 * Capaxero Cloud — Utilitário de validação e normalização de CPF
 * Usado no controle de limite de utilização de cupons por CPF.
 */

/** Remove qualquer máscara e devolve apenas os 11 dígitos. */
function sanitizeCpf(raw) {
  if (raw === null || raw === undefined) return '';
  return String(raw).replace(/\D+/g, '');
}

/** Valida o CPF pelos dígitos verificadores oficiais da Receita Federal. */
function isValidCpf(raw) {
  const cpf = sanitizeCpf(raw);
  if (cpf.length !== 11) return false;

  // Rejeita sequências repetidas (000.000.000-00, 111.111.111-11, ...)
  if (/^(\d)\1{10}$/.test(cpf)) return false;

  for (let round = 9; round <= 10; round++) {
    let sum = 0;
    for (let i = 0; i < round; i++) {
      sum += Number(cpf[i]) * (round + 1 - i);
    }
    let digit = (sum * 10) % 11;
    if (digit === 10) digit = 0;
    if (digit !== Number(cpf[round])) return false;
  }

  return true;
}

/** Formata o CPF no padrão 000.000.000-00 (devolve o original se não tiver 11 dígitos). */
function formatCpf(raw) {
  const cpf = sanitizeCpf(raw);
  if (cpf.length !== 11) return String(raw || '');
  return `${cpf.slice(0, 3)}.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-${cpf.slice(9)}`;
}

/**
 * Interruptor da exigência de CPF nos cupons.
 *
 * Desligado temporariamente a pedido: o cliente não digita CPF para usar um cupom, então o
 * backend não recusa mais validação nem resgate sem CPF.
 *
 * PARA RELIGAR: volte para `true` aqui e faça o mesmo no app, em
 * `APK-Capaxero/.../core/coupons/CouponCpfPolicy.kt` (constante IS_CPF_REQUIRED).
 * As duas pontas precisam estar de acordo.
 *
 * Nada foi apagado: `requireCpf` e `maxUsagesPerCpf` continuam gravados em cada cupom, o
 * histórico de resgates por CPF continua sendo registrado, e tudo volta a valer ao religar.
 *
 * Enquanto estiver desligado, o limite por CPF não é aplicado — só o `maxUsages` global
 * do cupom segura a quantidade de utilizações.
 */
const COUPON_CPF_ENABLED = false;

module.exports = { sanitizeCpf, isValidCpf, formatCpf, COUPON_CPF_ENABLED };
