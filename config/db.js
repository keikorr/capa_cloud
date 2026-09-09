/**
 * Capaxero Cloud — Configuração de Acesso ao PostgreSQL
 *
 * Funções, não constantes avaliadas no escopo do módulo: se algo um dia voltar a
 * requerer este arquivo antes de config/env.js carregar o .env (o mesmo problema de
 * ordem já resolvido para o Cielo em config/env.js), a leitura tardia continua correta.
 */
require('./env');

function getDatabaseUrl() {
  return process.env.DATABASE_URL || '';
}

/**
 * STORE_MODE ainda não é consumido em runtime (isso é trabalho da fase 3 do plano de
 * migração — o roteador em services/store.js). Existe aqui desde já para que os scripts
 * de infraestrutura (migrate, import) e o pool tenham uma única fonte da verdade sobre
 * se Postgres é esperado neste ambiente.
 */
function getStoreMode() {
  return process.env.STORE_MODE || 'json';
}

function requiresDatabase() {
  return getStoreMode() !== 'json';
}

function getPoolConfig() {
  return {
    connectionString: getDatabaseUrl(),
    max: Number(process.env.DATABASE_POOL_MAX || 10),
    idleTimeoutMillis: Number(process.env.DATABASE_IDLE_TIMEOUT_MS || 30000),
    connectionTimeoutMillis: Number(process.env.DATABASE_CONNECT_TIMEOUT_MS || 5000)
  };
}

module.exports = { getDatabaseUrl, getStoreMode, requiresDatabase, getPoolConfig };
