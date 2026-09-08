/**
 * Monta um banco JSON local a partir da API de produção, para servir de base aos
 * golden snapshots.
 *
 * O repositório local tem 1 totem; a produção tem 16, com donos, depots e grafias de
 * modalidade variados. Os snapshots só têm valor de regressão se rodarem sobre dados que
 * exercitam esses casos.
 *
 * O arquivo gerado contém credenciais Cielo (a API as devolve para CRPADMIN) e por isso
 * é escrito em data/fixture_prod.json, que fica fora do git. Não contém hashes de senha:
 * a API nunca os expõe, então os usuários recebem uma senha local conhecida.
 *
 * Uso:
 *   CAPAXERO_URL=https://capaxero.cloud CAPAXERO_LOGIN=... CAPAXERO_SENHA=... \
 *     node scripts/fetch_prod_dataset.js
 */
require('../config/env');

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const BASE = process.env.CAPAXERO_URL || 'https://capaxero.cloud';
const LOGIN = process.env.CAPAXERO_LOGIN;
const SENHA = process.env.CAPAXERO_SENHA;
const OUT = path.join(__dirname, '..', 'data', 'fixture_prod.json');

// Senha local conhecida para todos os usuários da fixture (o hash real nunca sai da produção)
const SENHA_FIXTURE = 'fixture123';

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

async function api(pathname, token) {
  const res = await fetch(`${BASE}${pathname}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {}
  });
  if (!res.ok) throw new Error(`${pathname} -> HTTP ${res.status}`);
  const body = await res.json();
  if (body.success === false) throw new Error(`${pathname} -> ${body.message}`);
  return body.data;
}

async function main() {
  if (!LOGIN || !SENHA) {
    console.error('Defina CAPAXERO_LOGIN e CAPAXERO_SENHA no ambiente.');
    process.exit(1);
  }

  console.log(`Autenticando em ${BASE}...`);
  const loginRes = await fetch(`${BASE}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: LOGIN, password: SENHA })
  });
  const loginBody = await loginRes.json();
  if (!loginBody.success) throw new Error(`Login falhou: ${loginBody.message}`);
  const token = loginBody.data.token;

  console.log('Coletando entidades...');
  const [totems, depots, users, alerts, transactions, coupons] = await Promise.all([
    api('/api/v1/admin/totems', token),
    api('/api/v1/admin/depots', token),
    api('/api/v1/admin/users', token),
    api('/api/v1/admin/alerts', token),
    api('/api/v1/admin/transactions?limit=5000', token),
    api('/api/v1/coupons', token)
  ]);

  // A API devolve os campos públicos do usuário; recompomos o password_hash com uma senha
  // local conhecida para que os testes consigam autenticar.
  const usersWithHash = users.map(u => ({
    ...u,
    password_hash: hashPassword(SENHA_FIXTURE)
  }));

  // revenueToday/totalCyclesToday vêm calculados pela API (getTodayMetrics). No arquivo de
  // banco eles são contadores acumulados; zeramos para não gravar um valor com outra semântica.
  const totemsRaw = totems.map(t => ({ ...t, revenueToday: 0, totalCyclesToday: 0 }));

  const db = {
    users: usersWithHash,
    totems: totemsRaw,
    depots,
    branches: [],
    transactions,
    alerts,
    coupons,
    systemSettings: {
      defaultCieloMerchantId: '',
      defaultCieloMerchantKey: ''
    }
  };

  fs.writeFileSync(OUT, JSON.stringify(db, null, 2), 'utf-8');

  console.log(`\nGravado em ${OUT}`);
  console.log(`  usuários     ${db.users.length}   (senha local: ${SENHA_FIXTURE})`);
  console.log(`  totens       ${db.totems.length}`);
  console.log(`  depots       ${db.depots.length}`);
  console.log(`  transações   ${db.transactions.length}`);
  console.log(`  alertas      ${db.alerts.length}`);
  console.log(`  cupons       ${db.coupons.length}`);

  // Diagnóstico das formas que motivaram a migração
  const porGrafia = {};
  for (const t of db.transactions) {
    porGrafia[t.mode] = (porGrafia[t.mode] || 0) + 1;
  }
  console.log('\n  grafias de modalidade encontradas:', JSON.stringify(porGrafia));

  const chaves = new Map();
  let duplicadas = 0;
  for (const t of db.transactions) {
    const k = `${t.orderId}|${t.devno}`;
    if (chaves.has(k)) duplicadas++;
    chaves.set(k, true);
  }
  console.log(`  transações com (orderId, devno) repetido: ${duplicadas}`);

  const depotnosReais = new Set(db.depots.map(d => d.depotno));
  const pendurados = [...new Set(db.totems.map(t => t.depotno).filter(dn => dn && !depotnosReais.has(dn)))];
  console.log(`  depotno referenciado por totem mas inexistente: ${JSON.stringify(pendurados)}`);
}

main().catch(err => {
  console.error('Falhou:', err.message);
  process.exit(1);
});
