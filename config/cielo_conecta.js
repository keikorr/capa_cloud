/**
 * Capaxero Cloud — Configuração da Integração Cielo Conecta (Cartão Presente)
 */
const fs = require('fs');
const path = require('path');

// Carrega .env se existir
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const idx = trimmed.indexOf('=');
      if (idx !== -1) {
        const key = trimmed.substring(0, idx).trim();
        const val = trimmed.substring(idx + 1).trim().replace(/^["']|["']$/g, '');
        if (!process.env[key]) {
          process.env[key] = val;
        }
      }
    }
  });
}

function env(name, fallback) {
  const value = process.env[name];
  return value !== undefined && value !== '' ? value : fallback;
}

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
