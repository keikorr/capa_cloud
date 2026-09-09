/**
 * Capaxero Cloud — Pool de Conexão PostgreSQL
 *
 * getPool() é preguiçoso: a Pool só é construída no primeiro uso, não no require deste
 * módulo. Isso permite que repositórios façam `require('../db/pool')` livremente no topo
 * do arquivo sem se preocupar com a ordem em que os módulos são carregados — o mesmo
 * problema que já resolvemos para o .env em config/env.js.
 */
const { Pool, types } = require('pg');
const { getPoolConfig } = require('../config/db');

// ─────────────────────────────────────────────────────────────────────────────
// ARMADILHA: o driver `pg` devolve NUMERIC (OID 1700) e BIGINT (OID 20) como STRING
// JavaScript, não number. getStats() sobrevive porque já faz Number(t.amount). Mas
// getIncomeReport() faz (revenue * dep.commissionPercent) / 100, e um SUM(amount)
// voltando como "357.00" dentro de um cálculo que trata o valor como number produz
// concatenação de string silenciosa — sem erro, sem warning, só um número errado no
// relatório de comissão dos pontos. Registrar isto ANTES de qualquer query é obrigatório.
// ─────────────────────────────────────────────────────────────────────────────
types.setTypeParser(1700, (val) => (val === null ? null : parseFloat(val))); // NUMERIC
types.setTypeParser(20, (val) => (val === null ? null : Number(val)));       // BIGINT

let pool = null;
let healthy = false;
let lastError = null;

function getPool() {
  if (!pool) {
    const config = getPoolConfig();
    if (!config.connectionString) {
      throw new Error(
        'DATABASE_URL não definida. Configure-a no .env antes de usar a camada Postgres ' +
        '(STORE_MODE diferente de "json" exige isso).'
      );
    }
    pool = new Pool(config);
    pool.on('error', (err) => {
      // Erros em clientes ociosos do pool (ex.: conexão derrubada pelo servidor) não devem
      // derrubar o processo — mas marcam o pool como não saudável para o /health reportar.
      healthy = false;
      lastError = err;
      console.error('[DB POOL] Erro em cliente ocioso:', err.message);
    });
    healthy = true;
  }
  return pool;
}

/**
 * Executa uma query única, pegando e devolvendo um client do pool automaticamente.
 */
async function query(text, params) {
  const result = await getPool().query(text, params);
  healthy = true;
  return result;
}

/**
 * Empresta um client do pool para múltiplas queries manuais (ex.: quando o chamador
 * quer controlar transação com BEGIN/COMMIT fora de withTx). Sempre libere com client.release().
 */
async function withClient(fn) {
  const client = await getPool().connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

/**
 * Executa fn dentro de uma transação. Faz commit se fn resolver, rollback se rejeitar.
 * O padrão que todo repositório com escrita composta (cupom + resgate, transação +
 * contador) deve usar em vez de chamadas soltas.
 */
async function withTx(fn) {
  return withClient(async (client) => {
    await client.query('BEGIN');
    try {
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  });
}

/**
 * Ping simples para o /health e para o reconciliador (fase 3) saberem se o Postgres está
 * respondendo, sem depender só do estado do último erro assíncrono do pool.
 */
async function ping() {
  try {
    await query('SELECT 1');
    healthy = true;
    lastError = null;
    return true;
  } catch (err) {
    healthy = false;
    lastError = err;
    return false;
  }
}

function isHealthy() {
  return healthy;
}

function getLastError() {
  return lastError;
}

/**
 * Fecha o pool. Chamado no shutdown gracioso do server.js quando a fase 3 ligar o
 * Postgres em runtime; scripts standalone (migrate, import) também chamam isto no fim.
 */
async function close() {
  if (pool) {
    await pool.end();
    pool = null;
    healthy = false;
  }
}

module.exports = { getPool, query, withClient, withTx, ping, isHealthy, getLastError, close };
