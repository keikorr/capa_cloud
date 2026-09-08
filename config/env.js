/**
 * Capaxero Cloud — Carregamento de Variáveis de Ambiente
 *
 * Este módulo precisa ser o PRIMEIRO require de qualquer entrypoint (server.js e todo
 * script em scripts/). Antes ele vivia dentro de config/cielo_conecta.js, que só é
 * carregado por routes/cielo.js — ou seja, bem depois de services/database.js. Qualquer
 * módulo que lesse process.env no escopo do módulo (ex.: DATABASE_URL) enxergaria undefined.
 *
 * Não usamos dotenv de propósito: o parser abaixo já resolve o caso de uso e o projeto
 * mantém a lista de dependências mínima.
 */
const fs = require('fs');
const path = require('path');

let loaded = false;

/**
 * Lê o .env da raiz do projeto para dentro de process.env.
 * Variáveis já presentes no ambiente real têm precedência e nunca são sobrescritas,
 * o que também torna esta função idempotente.
 */
function loadEnv() {
  if (loaded) return;
  loaded = true;

  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;

  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;

    const idx = trimmed.indexOf('=');
    if (idx === -1) return;

    const key = trimmed.substring(0, idx).trim();
    const val = trimmed.substring(idx + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[key]) {
      process.env[key] = val;
    }
  });
}

/**
 * Lê uma variável tratando string vazia como ausente.
 */
function env(name, fallback) {
  const value = process.env[name];
  return value !== undefined && value !== '' ? value : fallback;
}

loadEnv();

module.exports = { loadEnv, env };
