# Guia: atualizar o projeto e subir o PostgreSQL na VPS

Passo a passo completo: puxar o código mais recente (correções de duplicidade, fuso
horário, modalidade, vazamento entre franqueados, e a aba de Histórico por máquina) e
colocar o PostgreSQL no ar na VPS Hostinger (Ubuntu).

**O que muda em produção ao final deste guia:** as vendas do dia, ciclos e estatísticas
continuam vindo 100% do arquivo JSON, exatamente como hoje — isso só muda na Fase 3
(dual-write), que ainda não está pronta. A única coisa nova que passa a funcionar é a aba
**"Histórico (arquivo)"** dentro do modal de cada máquina, que passa a mostrar dados reais
em vez do aviso "arquivo não configurado". Nada existente é alterado ou arriscado.

---

## 0. Atualizar o projeto

```bash
cd /caminho/do/capaxero_cloud
git pull origin main
npm install
```

Isso traz, além da parte do Postgres: a correção de vendas duplicadas, a correção do
fuso horário nos ids, a correção do vazamento de locais entre franqueados, e o
`package.json` com os comandos `db:migrate` e `db:import` usados abaixo.

**Confirme que a correção de duplicidade está mesmo ativa** (ela foi enviada há alguns
dias; se a VPS não tinha sido atualizada até agora, pode ser a primeira vez que ela roda):

```bash
node scripts/dedupe_transactions.js
```

Modo simulação — não grava nada, só mostra quantas duplicatas existem. Se aparecer um
número alto, rode com `--apply` para limpar (ele faz backup automático antes):

```bash
node scripts/dedupe_transactions.js --apply
```

---

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

Troque `TROQUE_ESTA_SENHA` por uma senha forte de verdade — vai usar o mesmo valor no
`.env` no próximo passo.

## 3. Configurar o `.env` do projeto

```bash
nano .env
```

Adicione (ou ajuste) a linha de conexão — use a mesma senha do passo 2:

```env
DATABASE_URL=postgresql://capaxero:TROQUE_ESTA_SENHA@localhost:5432/capaxero_db
```

## 4. Aplicar o schema

```bash
npm run db:migrate
```

Isso roda, em ordem, as duas migrations que existem hoje:
- `001_initial_schema.sql` — cria as 12 tabelas e a view `transactions_business`.
- `002_history_indexes.sql` — cria o índice que a aba de Histórico usa para buscar rápido
  os cupons resgatados em cada máquina.

Registra o que já foi aplicado em `schema_migrations`, então rodar de novo é seguro (não
faz nada se já estiver tudo em dia):

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
- **Transações duplicadas que serão descartadas** — espera-se um número relevante aqui,
  é esperado e correto (é o mesmo defeito que o `dedupe_transactions.js` do passo 0
  resolve no JSON; o importador resolve de novo, só na carga para o Postgres).
- **depotno duplicado** — se o gerador antigo de id produziu dois pontos físicos
  diferentes com o mesmo código, o script renomeia o mais recente e reporta qual
  endereço foi para qual id novo. Confira se os endereços fazem sentido.
- **id de transação/alerta colidido** — mesma lógica, para o gerador de id antigo que
  podia produzir o mesmo id para dois registros diferentes.
- **totens com owner_id que não resolveu** — caíram para CRPADMIN; confira se algum
  precisa ser reatribuído manualmente depois.

Se o relatório fizer sentido, aplique de verdade (equivalente a `npm run db:import`):

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

## 7. Reiniciar o processo e ativar a aba de Histórico

O servidor só lê `DATABASE_URL` na inicialização — precisa reiniciar para pegar o que
foi configurado no passo 3.

```bash
pm2 restart capaxero_cloud
# ou, se não usa pm2:
sudo systemctl restart capaxero
```

Se não sabe qual dos dois está rodando, confira com `pm2 list` ou
`systemctl status capaxero`. Se nenhum dos dois existir, o processo provavelmente foi
iniciado manualmente (`node server.js` num terminal ou `.bat`) — pare e suba de novo do
mesmo jeito que sempre fez.

**Verificação final, no navegador:** entre no painel, abra qualquer máquina, clique na aba
"Histórico (arquivo)". Antes deste passo ela mostrava um aviso neutro "arquivo histórico
não configurado neste ambiente" — agora deve mostrar as vendas de verdade, com o resumo
(total, ticket médio, dias com venda) e a data em que o arquivo foi importado.

---

## O que NÃO fazer ainda

- **Não apague `data/capaxero_database.json`.** Continua sendo a fonte de tudo que o site
  usa no dia a dia — vendas de hoje, ciclos, cupons sendo resgatados agora. Só a aba de
  Histórico lê do Postgres; todo o resto do painel não muda em nada com este guia.
- **`STORE_MODE` no `.env` não tem efeito em runtime ainda** (isso é a Fase 3, que ainda
  não foi construída) — só existe para os scripts deste guia saberem que o Postgres é
  esperado neste ambiente. Pode deixar como está ou remover, tanto faz.

## Rollback

Se algo saiu errado na importação (passo 5), o JSON de produção nunca foi tocado —
`DROP DATABASE` e recomece do passo 4.

Se quiser desativar a aba de Histórico depois de já ter ativado (passo 7), sem desfazer
nada do banco: apague ou comente a linha `DATABASE_URL` no `.env` e reinicie o processo.
A aba volta a mostrar "arquivo não configurado" e o resto do site continua exatamente
igual — nenhuma outra rota depende dessa variável.
