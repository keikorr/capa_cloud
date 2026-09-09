#!/usr/bin/env node
/**
 * Capaxero Cloud — CLI de Migrations
 *
 * Uso:
 *   node scripts/migrate.js              aplica as migrations pendentes
 *   node scripts/migrate.js --dry-run    lista o que seria aplicado, sem executar
 *   node scripts/migrate.js --status     mostra aplicadas/pendentes e sai
 *
 * Requer DATABASE_URL no ambiente ou no .env.
 */
require('../config/env');

const { runMigrations, getStatus } = require('../db/migrate');
const pool = require('../db/pool');

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const statusOnly = process.argv.includes('--status');

  if (statusOnly) {
    const status = await getStatus();
    console.log(`Total: ${status.total}`);
    console.log(`Aplicadas (${status.applied.length}): ${status.applied.join(', ') || '(nenhuma)'}`);
    console.log(`Pendentes (${status.pending.length}): ${status.pending.join(', ') || '(nenhuma)'}`);
    return;
  }

  const applied = await runMigrations({ dryRun });
  if (!dryRun && applied.length) {
    console.log(`\n${applied.length} migration(s) aplicada(s) com sucesso.`);
  }
}

main()
  .catch(err => {
    console.error('Falhou:', err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.close());
