# Guia: subindo o PostgreSQL para o Capaxero Cloud na VPS

Passo a passo para instalar o PostgreSQL 17 na VPS Hostinger (Ubuntu) e rodar o schema +
a importação dos dados atuais. Corresponde à Fase 2 do plano em `MIGRACAO.md`.

**Importante:** ao final deste guia, o Postgres existe e está populado, mas o servidor
(`server.js`) continua rodando 100% sobre o JSON em `data/`. Nada muda no app em produção
até a Fase 3 (dual-write) — este guia é seguro de rodar a qualquer momento, sem risco para
o que já está no ar.

## 1. Instalar o PostgreSQL na VPS

```bash
sudo apt update -y
sudo apt install postgresql-17 postgresql-contrib -y
sudo systemctl enable postgresql
sudo systemctl start postgresql
```

Se `postgresql-17` não estiver disponível no repositório padrão da sua distro, adicione o
repositório oficial da PostgreSQL Global Development Group primeiro:

```bash
sudo apt install -y postgresql-common
sudo /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y
sudo apt install postgresql-17 postgresql-contrib -y
```

## 2. Criar o banco e o usuário

```bash
sudo -u postgres psql
```

Dentro do `psql`:

```sql
CREATE DATABASE capaxero_db;
CREATE USER capaxero WITH ENCRYPTED PASSWORD 'TROQUE_ESTA_SENHA';
GRANT ALL PRIVILEGES ON DATABASE capaxero_db TO capaxero;
\c capaxero_db
GRANT ALL ON SCHEMA public TO capaxero;
\q
```

## 3. Configurar o `.env` do projeto

```bash
cd /caminho/do/capaxero_cloud
git pull origin main
npm install
nano .env
```

Adicione (ou ajuste):

```env
DATABASE_URL=postgresql://capaxero:TROQUE_ESTA_SENHA@localhost:5432/capaxero_db
STORE_MODE=json
```

`STORE_MODE=json` é o valor certo por enquanto — o servidor ainda não lê essa variável em
runtime (isso é trabalho da Fase 3). Ela existe desde já para os scripts abaixo saberem que
o Postgres é esperado neste ambiente.

## 4. Aplicar o schema

```bash
npm run db:migrate
```

Isso roda `db/migrations/001_initial_schema.sql`, criando as 12 tabelas + a view
`transactions_business`. Registra o que já foi aplicado em `schema_migrations`, então rodar
de novo é seguro (não faz nada se já estiver tudo em dia):

```bash
npm run db:migrate:status
```

## 5. Importar os dados de produção

**Antes de tudo, faça um backup do JSON atual** (é o único backup real que existe hoje,
já que `save()` reescreve o arquivo por inteiro a cada mutação):

```bash
cp data/capaxero_database.json data/capaxero_database.json.backup-$(date +%Y%m%d)
```

Rode primeiro em modo simulação — não grava nada, só mostra o que aconteceria:

```bash
node scripts/import_json.js data/capaxero_database.json
```

Leia o relatório com atenção. Ele avisa sobre:
- **Transações duplicadas que serão descartadas** (o defeito nº 1 do `MIGRACAO.md` —
  espera-se um número alto aqui, é esperado e correto).
- **depotno duplicado** — se o gerador antigo de id produziu dois pontos físicos diferentes
  com o mesmo código, o script renomeia o mais recente e reporta qual endereço foi para
  qual id novo. Confira se os endereços fazem sentido.
- **id de transação/alerta colidido** — mesma lógica, para o gerador de id antigo (corrigido
  na Fase 0) que podia produzir o mesmo id para dois registros diferentes.
- **totens com owner_id que não resolveu** — caíram para CRPADMIN; confira se algum
  precisa ser reatribuído manualmente depois.

Se o relatório fizer sentido, aplique de verdade:

```bash
node scripts/import_json.js data/capaxero_database.json --apply
```

É carga única: se precisar reimportar (ex.: corrigiu algo e quer recomeçar), recrie o banco
primeiro —

```bash
sudo -u postgres psql -c "DROP DATABASE capaxero_db;"
sudo -u postgres psql -c "CREATE DATABASE capaxero_db;"
sudo -u postgres psql -d capaxero_db -c "GRANT ALL ON SCHEMA public TO capaxero;"
npm run db:migrate
node scripts/import_json.js data/capaxero_database.json --apply
```

## 6. Conferir os dados

```bash
sudo -u postgres psql -d capaxero_db
```

```sql
-- Confere que o total de faturamento aprovado bate com o que o painel mostra
SELECT count(*), sum(amount_cents)/100.0 AS total_reais
FROM transactions WHERE status = 'APPROVED';

-- Confere que a constraint de duplicidade está mesmo em vigor
\d transactions

-- Confere o dia comercial no fuso certo (deve mudar à meia-noite de Fortaleza, não UTC)
SELECT public_id, occurred_at, business_date FROM transactions_business ORDER BY occurred_at DESC LIMIT 5;
```

## O que NÃO fazer ainda

- **Não configure o app para ler do Postgres.** `STORE_MODE` não é consumido em runtime
  ainda — mudar essa variável hoje não tem efeito algum no servidor.
- **Não apague `data/capaxero_database.json`.** Continua sendo a fonte da verdade do
  sistema até a Fase 5 do plano.

## Rollback

Não há o que reverter: nada em produção foi alterado por este guia. O Postgres existe e
está populado, isolado do que o servidor realmente usa. Se algo saiu errado na importação,
`DROP DATABASE` e recomece do passo 4 — o JSON de produção nunca foi tocado.
