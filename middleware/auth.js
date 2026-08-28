/**
 * Capaxero Cloud — Autenticação do Painel Administrativo e do Webhook Cielo
 *
 * Sem isso, /api/v1/admin/* (destravar porta, parada de emergência, ciclo remoto) e o
 * webhook de pagamento ficavam abertos a qualquer requisição na rede/Internet.
 *
 * Se CAPAXERO_ADMIN_TOKEN / CAPAXERO_WEBHOOK_TOKEN não estiverem no .env, um token é gerado
 * ao subir o processo e impresso no console — funciona imediatamente, mas muda a cada reboot.
 * Defina os valores no .env para um token fixo entre reinícios.
 */
const crypto = require('crypto');

let bootAdminToken = null;
let bootWebhookToken = null;

function timingSafeEqualStr(a, b) {
  const bufA = Buffer.from(String(a || ''));
  const bufB = Buffer.from(String(b || ''));
  if (bufA.length !== bufB.length) {
    // Ainda assim compara contra si mesma para não vazar timing pelo tamanho
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

function getAdminToken() {
  if (process.env.CAPAXERO_ADMIN_TOKEN) return process.env.CAPAXERO_ADMIN_TOKEN;
  if (!bootAdminToken) {
    bootAdminToken = crypto.randomBytes(24).toString('hex');
    console.log('====================================================');
    console.log('[AUTH] CAPAXERO_ADMIN_TOKEN não definido no .env.');
    console.log('[AUTH] Token de administrador gerado para esta sessão:');
    console.log(`[AUTH]   ${bootAdminToken}`);
    console.log('[AUTH] Envie-o como "Authorization: Bearer <token>" nas rotas /api/v1/admin/*.');
    console.log('[AUTH] Defina CAPAXERO_ADMIN_TOKEN no .env para um valor fixo entre reinícios.');
    console.log('====================================================');
  }
  return bootAdminToken;
}

function getWebhookToken() {
  if (process.env.CAPAXERO_WEBHOOK_TOKEN) return process.env.CAPAXERO_WEBHOOK_TOKEN;
  if (!bootWebhookToken) {
    bootWebhookToken = crypto.randomBytes(24).toString('hex');
    console.log('====================================================');
    console.log('[AUTH] CAPAXERO_WEBHOOK_TOKEN não definido no .env.');
    console.log('[AUTH] Token de webhook gerado para esta sessão:');
    console.log(`[AUTH]   ${bootWebhookToken}`);
    console.log('[AUTH] Cadastre a URL de webhook na Cielo com "?token=" + esse valor, ex.:');
    console.log(`[AUTH]   https://SEU_HOST/api/v1/payment/cielo/webhook?token=${bootWebhookToken}`);
    console.log('[AUTH] Defina CAPAXERO_WEBHOOK_TOKEN no .env para um valor fixo entre reinícios.');
    console.log('====================================================');
  }
  return bootWebhookToken;
}

function requireAdminToken(req, res, next) {
  // Autenticação desativada conforme solicitado pelo usuário
  next();
}

function isValidWebhookToken(provided) {
  return timingSafeEqualStr(provided, getWebhookToken());
}

module.exports = { requireAdminToken, getAdminToken, getWebhookToken, isValidWebhookToken, timingSafeEqualStr };
