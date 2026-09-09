/**
 * Capaxero Cloud — Runner de Migrations
 *
 * Lê db/migrations/*.sql em ordem de nome de arquivo, aplica as que ainda não constam em
 * schema_migrations, e registra cada uma na mesma transação em que foi executada — nunca
 * fica "aplicada mas não registrada" nem o inverso.
 *
 * Usa pg_advisory_lock para que dois processos tentando migrar ao mesmo tempo (ex.: um
 * deploy disparado duas vezes) não corram a mesma migration em paralelo. O lock é por
 * sessão: se o processo morrer, o Postgres libera sozinho.
 */
const fs = require('fs');
const path = require('path');
const { withClient } = require('./pool');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

// Numérico arbitrário mas estável, só precisa ser único dentro do banco. Não colide com
// nenhum outro lock advisory deste projeto porque não existe nenhum outro ainda.
const ADVISORY_LOCK_KEY = 8825_2026;

function listMigrationFiles() {
  if (!fs.existsSync(MIGRATIONS_DIR)) return [];
  return fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort(); // "001_", "002_", ... ordena lexicograficamente = ordem de aplicação
}

async function ensureMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename    TEXT PRIMARY KEY,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

async function getAppliedMigrations(client) {
  const { rows } = await client.query('SELECT filename FROM schema_migrations ORDER BY filename');
  return new Set(rows.map(r => r.filename));
}

/**
 * Aplica todas as migrations pendentes. Retorna a lista de arquivos aplicados nesta
 * chamada (vazia se já estava tudo em dia).
 */
async function runMigrations({ dryRun = false } = {}) {
  const applied = [];

  await withClient(async (client) => {
    await client.query('SELECT pg_advisory_lock($1)', [ADVISORY_LOCK_KEY]);
    try {
      await ensureMigrationsTable(client);
      const alreadyApplied = await getAppliedMigrations(client);
      const files = listMigrationFiles();
      const pending = files.filter(f => !alreadyApplied.has(f));

      if (pending.length === 0) {
        console.log('[MIGRATE] Nada a fazer — todas as migrations já aplicadas.');
        return;
      }

      console.log(`[MIGRATE] ${pending.length} migration(s) pendente(s): ${pending.join(', ')}`);

      for (const filename of pending) {
        const filePath = path.join(MIGRATIONS_DIR, filename);
        const sql = fs.readFileSync(filePath, 'utf-8');

        if (dryRun) {
          console.log(`[MIGRATE] (dry-run) aplicaria ${filename}`);
          continue;
        }

        console.log(`[MIGRATE] aplicando ${filename}...`);
        await client.query('BEGIN');
        try {
          await client.query(sql);
          await client.query(
            'INSERT INTO schema_migrations (filename) VALUES ($1)',
            [filename]
          );
          await client.query('COMMIT');
          applied.push(filename);
          console.log(`[MIGRATE] ${filename} aplicada com sucesso.`);
        } catch (err) {
          await client.query('ROLLBACK');
          console.error(`[MIGRATE] FALHOU em ${filename}:`, err.message);
          throw err;
        }
      }
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_KEY]);
    }
  });

  return applied;
}

async function getStatus() {
  return withClient(async (client) => {
    await ensureMigrationsTable(client);
    const applied = await getAppliedMigrations(client);
    const files = listMigrationFiles();
    return {
      total: files.length,
      applied: files.filter(f => applied.has(f)),
      pending: files.filter(f => !applied.has(f))
    };
  });
}

module.exports = { runMigrations, getStatus, listMigrationFiles };
