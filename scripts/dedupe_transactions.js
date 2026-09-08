/**
 * Limpeza única de transações duplicadas (ciclos/faturamento dobrados).
 *
 * Antes da correção em services/database.js, cada venda podia ser gravada
 * duas vezes: uma pelo sync do totem (/telemetry/transactions) e outra pelo
 * webhook/polling da Cielo confirmando o mesmo pedido (mesmo orderId+devno).
 * Este script remove as duplicatas já existentes no banco e recalcula os
 * contadores totalCyclesToday/revenueToday de cada totem a partir do
 * histórico de transações já sem duplicidade.
 *
 * Uso:
 *   node scripts/dedupe_transactions.js            # simula e mostra o que seria removido
 *   node scripts/dedupe_transactions.js --apply     # aplica de fato e salva o banco
 *
 * Faça backup do arquivo data/capaxero_database.json antes de rodar com --apply
 * (o script também cria um backup automático .bak-<timestamp> antes de salvar).
 */

const fs = require('fs');
const path = require('path');

const APPLY = process.argv.includes('--apply');
const DB_FILE = path.join(__dirname, '..', 'data', 'capaxero_database.json');
const LEGACY_DB_FILE = path.join(__dirname, '..', 'data', 'capaxero_db.json');

const raw = fs.readFileSync(DB_FILE, 'utf-8');
const tables = JSON.parse(raw);

const seen = new Map(); // key: orderId|devno -> transação mantida
const kept = [];
const removed = [];

// Ordena por timestamp crescente para que a transação mantida seja sempre
// a primeira confirmação real (a mais antiga), e as demais sejam tratadas
// como duplicatas do mesmo pedido.
const sorted = [...tables.transactions].sort((a, b) =>
  new Date(a.timestamp || 0) - new Date(b.timestamp || 0)
);

for (const tx of sorted) {
  const key = tx.orderId && tx.devno && tx.status === 'APPROVED'
    ? `${tx.orderId}|${tx.devno}`
    : `__unique__|${tx.id}`;

  if (seen.has(key)) {
    removed.push(tx);
  } else {
    seen.set(key, tx);
    kept.push(tx);
  }
}

// Mantém a ordem original (mais recente primeiro)
kept.sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));

console.log(`Transações totais:      ${tables.transactions.length}`);
console.log(`Transações mantidas:    ${kept.length}`);
console.log(`Duplicatas removidas:   ${removed.length}`);

if (removed.length) {
  const revenueRemoved = removed.reduce((acc, t) => acc + Number(t.amount || 0), 0);
  console.log(`Faturamento duplicado removido: R$ ${revenueRemoved.toFixed(2)}`);
  console.log('\nExemplos de duplicatas removidas:');
  removed.slice(0, 10).forEach(t => {
    console.log(`  - ${t.id}  orderId=${t.orderId}  devno=${t.devno}  R$${t.amount}  ${t.timestamp}`);
  });
  if (removed.length > 10) console.log(`  ... e mais ${removed.length - 10}`);
}

// Recalcula os contadores acumulados de cada totem a partir do histórico já limpo
const revenueByDevno = new Map();
const cyclesByDevno = new Map();
for (const t of kept) {
  if (t.status !== 'APPROVED' || !t.devno) continue;
  revenueByDevno.set(t.devno, (revenueByDevno.get(t.devno) || 0) + Number(t.amount || 0));
  cyclesByDevno.set(t.devno, (cyclesByDevno.get(t.devno) || 0) + 1);
}

console.log('\nContadores por totem (antes -> depois):');
for (const totem of tables.totems) {
  const newRevenue = revenueByDevno.get(totem.devno) || 0;
  const newCycles = cyclesByDevno.get(totem.devno) || 0;
  if (totem.revenueToday !== newRevenue || totem.totalCyclesToday !== newCycles) {
    console.log(`  ${totem.devno}: R$${totem.revenueToday || 0} / ${totem.totalCyclesToday || 0} ciclos  ->  R$${newRevenue.toFixed(2)} / ${newCycles} ciclos`);
  }
  if (APPLY) {
    totem.revenueToday = Number(newRevenue.toFixed(2));
    totem.totalCyclesToday = newCycles;
  }
}

if (!APPLY) {
  console.log('\nSimulação apenas — nada foi salvo. Rode novamente com --apply para gravar as alterações.');
  process.exit(0);
}

tables.transactions = kept;

const backupPath = `${DB_FILE}.bak-${Date.now()}`;
fs.writeFileSync(backupPath, raw, 'utf-8');
console.log(`\nBackup salvo em: ${backupPath}`);

const payload = JSON.stringify(tables, null, 2);
fs.writeFileSync(DB_FILE, payload, 'utf-8');
fs.writeFileSync(LEGACY_DB_FILE, payload, 'utf-8');
console.log('Banco de dados atualizado com sucesso (duplicatas removidas).');
