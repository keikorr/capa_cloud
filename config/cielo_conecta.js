/**
 * Capaxero Cloud — Configuração da Integração Cielo Conecta (Cartão Presente)
 */
// O .env é carregado por config/env.js, que também é o primeiro require do server.js.
// Manter o require aqui garante que este módulo funcione mesmo se carregado isoladamente
// (ex.: por um script), já que loadEnv() é idempotente.
const { env } = require('./env');

const ENVIRONMENT = env('CIELO_ENVIRONMENT', 'Homologacao');

const ENVIRONMENT_HEADERS = {
  Sandbox: { master: 'Homologacao15', payment: 'Homologacao15' },
  Homologacao: { master: 'Homologacao15', payment: 'Homologacao15' },
  Producao: { master: null, payment: null }
};

module.exports = {
  environment: ENVIRONMENT,
  environmentHeaders: ENVIRONMENT_HEADERS[ENVIRONMENT] || ENVIRONMENT_HEADERS.Homologacao,

  authUrl: env('CIELO_AUTH_URL', ''),
  baseUrl: env('CIELO_BASE_URL', ''),
  initUrl: env('CIELO_INIT_URL', ''),

  clientId: env('CIELO_CLIENT_ID', ''),
  clientSecret: env('CIELO_CLIENT_SECRET', ''),

  scopeMaster: env('CIELO_SCOPE_MASTER', 'PhysicalCieloMaster'),
  scopeTransactional: env('CIELO_SCOPE_TRANSACTIONAL', 'PhysicalCieloTransactional'),

  tokenRefreshMarginSeconds: Number(env('CIELO_TOKEN_MARGIN_SECONDS', '60')),

  merchantId: env('CIELO_SUBORDINATED_MERCHANT_ID', ''),
  terminalId: env('CIELO_TERMINAL_ID', ''),

  pinpad: {
    license: env('CIELO_PINPAD_LICENSE', ''),
    companyName: env('CIELO_PINPAD_COMPANY', ''),
    comm: env('CIELO_PINPAD_COMM', 'USB')
  },

  initializationCacheMinutes: Number(env('CIELO_INIT_CACHE_MINUTES', '720')),
  simulator: env('CIELO_SIMULATOR', 'auto'),
  cardTimeoutSeconds: Number(env('CIELO_CARD_TIMEOUT_SECONDS', '90'))
};
