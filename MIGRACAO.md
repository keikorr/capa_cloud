# Capaxero Cloud — Diagnóstico, Correções e Migração para PostgreSQL

> Documento de acompanhamento. Registra o que foi investigado, o que já foi corrigido e o
> que falta fazer. Atualizado em 09/09/2026.

---

## 1. Resumo executivo

A investigação começou por uma queixa simples: *"os dados das vendas e ciclos não estão
conforme as vendas das máquinas"*. A causa não era um defeito, e sim **três defeitos
independentes se acumulando** — e todos os três nascem da mesma raiz: o sistema guarda tudo
num arquivo JSON, sem constraints, sem tipos e sem transações.

| # | Defeito | Efeito no painel | Situação |
|---|---|---|---|
| 1 | Sem constraint em `(orderId, devno)` | Toda venda contada 2× | Corrigido no JSON (falta confirmar na VPS); virou `UNIQUE` no schema Postgres |
| 2 | "Hoje" calculado em UTC, operação é UTC-3 | Dia comercial vira às 21h de Fortaleza | View `transactions_business` já existe no Postgres; troca de verdade é fase 4 |
| 3 | `mode` gravado com e sem acento | 61% dos ciclos fora do gráfico de modalidade | Corrigido no JSON e no git; virou `CHECK` no schema Postgres |

**Evidência dos três somados**, colhida ao vivo da produção: o painel exibia `4 ciclos /
R$ 60` como faturamento de "hoje". Eram **2 vendas reais** (duplicação ×2) que aconteceram
**às 21h25 e 21h26 do dia anterior** (fuso). O número correto de "hoje" naquele instante
era **zero**.

Além disso, a persistência atual tem um modo de falha capaz de destruir a base inteira, e
existem três problemas de segurança que precisam de decisão sua (seção 7).

---

## 2. Diagnóstico detalhado

Os números abaixo vêm de uma cópia real da produção (821 transações, 16 totens, 13 pontos,
2 usuários), reconstruída via API em 08/09/2026.

### 2.1 Defeito nº 1 — vendas contadas em dobro

Cada venda real era gravada **duas vezes** na tabela de transações:

```
TX-227511  ORD-73048  R$15  "Intermediária"   PIX Instantâneo   09:26:46.959
TX-206919  ORD-73048  R$15  "INTERMEDIARIA"   PIX_CIELO         09:26:46.919
```

Mesmo pedido, mesma máquina, mesmo valor, 40 ms de diferença. Uma linha vem do totem
sincronizando a confirmação local (`routes/api.js` → `/telemetry/transactions`), a outra do
webhook da Cielo confirmando **o mesmo pagamento** (`routes/cielo.js`, em três call sites
distintos). Ambos chamavam `store.addTransaction()`, que não verificava se já existia
registro para aquele `orderId`.

**Escala real: 325 das 821 transações (~40%) são duplicatas.**

Duplicatas criadas por dia, na reta final da base:

```
2026-09-04 ->  88
2026-09-05 -> 101
2026-09-06 -> 111
2026-09-07 ->  20
2026-09-08 ->   2   (última transação da base)
```

> ⚠️ **As duplicatas seguiam sendo criadas até a transação mais recente da base.** Isso
> indica que a correção `68dd12d` ainda não estava ativa na VPS quando esses dados foram
> coletados. Só é possível confirmar que ela passou a valer depois que novas vendas
> ocorrerem — ver seção 6.1.

### 2.2 Defeito nº 2 — o dia comercial vira às 21h

Três funções calculam "hoje" usando data **UTC**:

| Arquivo | O que calcula |
|---|---|
| `services/database.js:445` | `getTodayMetrics()` — faturamento e ciclos por totem |
| `services/database.js:965` | `getStats()` — os KPIs do topo do painel |
| `services/database.js:1030` | `getIncomeReport()` — a série de 7 dias |

Todas fazem `new Date().toISOString().slice(0, 10)`, que devolve a data em UTC. A operação
é em Fortaleza (UTC−3, sem horário de verão), então **toda venda entre 21h e meia-noite é
contabilizada no dia seguinte**.

Não está corrigido ainda: a correção certa é guardar `TIMESTAMPTZ` e calcular o dia com
`AT TIME ZONE 'America/Fortaleza'`, o que só faz sentido junto da migração (fase 4).

### 2.3 Defeito nº 3 — a modalidade mais vendida marcava zero

O campo `mode` era gravado em grafias incompatíveis conforme o caminho: as rotas do backend
mandavam `'INTERMEDIARIA'`, o APK mandava `'Intermediária'`, o simulador mandava `'inter'`.
Mas o `getStats()` classificava comparando a chave direta contra
`{ BASICA, INTERMEDIARIA, AVANCADA }`.

Distribuição real na produção:

| Grafia gravada | Linhas | Contava no gráfico? |
|---|---:|---|
| `Avançada` | 453 | ❌ |
| `INTERMEDIARIA` | 323 | ✅ |
| `Intermediária` | 28 | ❌ |
| `Básica` | 17 | ❌ |

**498 das 821 linhas (61%) eram simplesmente ignoradas.** E note: `Avançada` é a modalidade
mais vendida, e **não existe nenhuma linha `AVANCADA`** — a barra dela marcava zero
permanentemente. O único bucket com número era `INTERMEDIARIA`, que é justamente a grafia
que o webhook da Cielo grava **nas linhas duplicadas**.

Ou seja: o gráfico de modalidades estava, na prática, contando só as duplicatas.

> Consequência não óbvia: a correção do defeito nº 1, sozinha, **piora** este gráfico. O
> dedupe mantém a linha mais antiga de cada pedido, que é justamente a acentuada — então o
> gráfico passaria a marcar zero em tudo. Por isso as duas correções precisam andar juntas.

### 2.4 Riscos estruturais encontrados no caminho

Não causaram a queixa original, mas são graves:

- **`save()` não é atômico** (`services/database.js:194`). Trunca o arquivo no lugar, sem
  temp+rename e sem fsync, a cada mutação — inclusive a cada heartbeat (1×/min por totem,
  16 totens). Se o processo morrer no meio da escrita, o JSON fica inválido; e no boot
  seguinte o `initDatabase()` captura o erro de parse e **sobrescreve com um banco vazio**.
  Perda total e silenciosa.
- **Teto de 1000 transações** (`addTransaction`). O painel pede `limit=5000`, mas o histórico
  além de 1000 linhas é descartado em silêncio.
- **IDs que colidiam**: `transactions.id` usava os últimos 6 dígitos do epoch (repete a cada
  16,7 min); `alerts.id`, 5 dígitos (repete a cada 100 s); `depots.depotno` e
  `branches.branno` usavam `length + 1`, reaproveitando id após qualquer exclusão.
- **`pendingOrders` só existe em memória.** Um crash entre a autorização da Cielo e o
  `/card/finish` perde o registro, e o cliente fica cobrado sem estorno.
- **`DEP-01` é sentinela, não ponto real.** Dez totens apontam para um `depotno` que não
  existe na tabela de pontos (os reais são `DEP-1`..`DEP-13`).
- **Vazamento entre franqueados**: `getDepotsList(userFilter)` aceitava o filtro e nunca o
  usava. O dono MAGNO enxergava os 13 pontos da rede quando só 2 têm máquina dele.

---

## 3. O que já foi feito

Fases 0 e 2 do plano, todas em `main`. **O servidor continua rodando 100% sobre o JSON** —
o Postgres da Fase 2 existe e está populado num banco local de teste, mas nada em produção
lê ou escreve nele ainda (isso é a Fase 3).

| Commit | O quê | Verificação feita |
|---|---|---|
| `68dd12d` | Dedupe de transações por `(orderId, devno)` em `addTransaction()` | Duas chamadas com mesmo pedido devolvem a mesma linha |
| `a98a445` | `scripts/dedupe_transactions.js` — limpa duplicatas já gravadas | Simulação sobre dados reais identificou as duplicatas corretamente |
| `6cc8f9d` | `.env` carregado no primeiro require do processo | Servidor sobe lendo `CIELO_ENVIRONMENT=Producao` do arquivo |
| `757b285` | Normalização de modalidade + geradores de id sem colisão | 50.000 ids gerados, 0 colisões; 19 grafias de modalidade mapeadas |
| `932e3f6` | Shutdown gracioso (SIGTERM/SIGINT) + guardas nos dois watchdogs | Handler encerra limpo com exit 0, sem estourar o timeout |
| `fe9e09b` | Usuário autenticado resolvido pela sessão, sem tocar no banco | Edição reflete na sessão; exclusão devolve 401; RBAC preservado |
| `67f2458` | Golden snapshots (18 rotas) + correção do vazamento de pontos | Regressão deliberada foi detectada: "esperado 2, obtido 13", exit 1 |
| *(este commit)* | Fase 2: schema PostgreSQL, pool, runner de migrations, importador | Ver 3.3 — testado ponta a ponta contra um retrato real da produção |

### 3.1 Por que o `fe9e09b` importa mais do que parece

`getUserFromToken()` consultava o banco a cada requisição só para "atualizar" os dados, mas
a sessão em memória já guardava tudo que os consumidores leem. A função é exportada, o
`admin.js` a embrulha em `extractUser()`, e quase toda rota administrativa começa por aí.

Se ela virasse assíncrona, **todo o `admin.js` teria que virar assíncrono em cascata** — sem
ganho nenhum. Lendo da sessão, ela fica síncrona para sempre. Isso sozinho elimina cerca de
**25 das conversões** que a migração exigiria.

A contrapartida (sessão defasada) é coberta por dois hooks: `refreshSessionsForUser()` na
edição de perfil e `invalidateSessionsForUser()` na exclusão de conta.

### 3.2 A rede de segurança (`tests/golden.js`)

É o artefato mais importante já entregue. Sobe o servidor sobre uma cópia descartável de um
retrato da produção, bate em 18 rotas como CRPADMIN **e** como OWNER, e compara a resposta
com o que está gravado em `tests/golden/`.

Rode `npm test` após **cada** alteração das fases seguintes. É o que prova que converter
161 call sites para async e trocar o datastore não mudou nada visível na API.

Detalhes de projeto que valem registro:

- **Campos voláteis** (timestamps, ids gerados, contadores do dia) viram marcador estável,
  senão todo snapshot divergiria a cada execução.
- **Credenciais nunca são gravadas em claro.** A primeira captura trouxe chaves Cielo em
  texto puro; hoje elas viram assinatura (`<segredo:aberto:len=40>` para CRPADMIN,
  `<segredo:vazio>` para OWNER). Isso esconde o valor **mas preserva o sinal de RBAC**: se o
  mascaramento por perfil quebrar, a assinatura muda e o teste acusa.
- **A fixture fica fora do git** (`data/fixture_prod.json`), porque contém credenciais Cielo
  por totem. Regenerável com `npm run fixture`.

### 3.3 Fase 2 — o banco Postgres existe e foi testado com dados reais

`config/db.js`, `db/pool.js`, `db/migrate.js`, `db/migrations/001_initial_schema.sql`,
`scripts/migrate.js`, `scripts/import_json.js`. Doze tabelas + a view
`transactions_business`, detalhadas na seção 5.

Validado de ponta a ponta contra um PostgreSQL local (instalado só para este teste — não é
o de produção) populado com o retrato real de 08/09/2026: 16 totens, 821 transações, 103
alertas. Cada garantia do schema foi testada tentando quebrá-la de propósito:

- Duas transações com o mesmo `(orderId, devno)` → a segunda é rejeitada pelo banco.
- Modalidade fora de `{BASICA, INTERMEDIARIA, AVANCADA}` → rejeitada.
- Venda às 21h30 de Fortaleza (00h30 UTC) → `transactions_business.business_date` cai no
  dia local certo, não no dia UTC seguinte.
- Cupom tentando passar de `max_usages` → rejeitado pela `CHECK`.
- `NUMERIC`/`BIGINT` voltam como `number` do driver `pg`, não como string (a armadilha da
  seção 5) — confirmado que `0 + valor` não vira concatenação.
- Rodar o importador duas vezes contra um banco já populado falha limpo na primeira tabela,
  sem duplicar nada — é carga única, não sincronização.

**A importação, rodada de verdade contra o retrato da produção, encontrou e corrigiu
automaticamente quatro problemas de integridade que só apareceram testando com dados reais
(não teriam sido pegos revisando o schema no papel):**

| Problema encontrado | Como apareceu | Como foi resolvido |
|---|---|---|
| `depotno` duplicado | `DEP-3` e `DEP-12` cada um com **dois pontos físicos diferentes** (endereços distintos) — o gerador antigo (`length+1`, corrigido na fase 0) reaproveitou o id depois de uma exclusão | Mantém o mais antigo no id original, cunha id novo para o resto, reporta o endereço de cada renomeação |
| `id` de alerta duplicado | `ALT-14526` apontando para **dois alertas reais**, dois dias de diferença (`LOW_LIQUID_LEVEL` em `CPX-MESSEJANA`) — o gerador antigo (5 dígitos do epoch, corrigido na fase 0) repetia a cada 100s | Mesma lógica: nunca descarta, cunha id novo pro mais recente |
| `depotna` genérico | **Todos os 13 pontos** de produção tinham `depotna = "Ponto de Instalação"` (o placeholder) — o nome real ("Merit Offices & Mall", "Parque São José"...) só existia num campo `name` que chegou por acidente via spread de cliente | Prefere o nome real quando `depotna` é só o placeholder |
| `owner_id` órfão | Verificado contra os 2 usuários reais — nenhum caso nesta base, mas o importador resolve por nome e cai para CRPADMIN reportando o motivo, para não travar numa base com o problema |

Conferência financeira: a soma das transações aprovadas após dedupe bateu **exatamente**
entre o JSON de origem e o Postgres — 496 transações, R$ 3.305,29, nos dois lados.

**Achado colateral no processo:** os golden snapshots da seção 3.2 tinham uma falha de
desenho — `totalRevenueToday`, `modeCounts` e a série de 7 dias do `getIncomeReport` são
calculados contra "agora", não contra a data da fixture, então rodar a suíte em dois dias-
calendário diferentes os fazia divergir mesmo sem nenhuma mudança de código (exatamente o
defeito nº 2 em ação). Corrigido mascarando esses campos como voláteis em
`tests/golden.js` — a correção de verdade do fuso é da fase 4.

Instalação usada para testar (Windows, ambiente de desenvolvimento — a VPS roda Ubuntu):
PostgreSQL 17 via `winget`, mais um segundo cluster standalone (`initdb`/`pg_ctl` numa
pasta de scratch, porta 5433) para não depender de privilégio de administrador para
controlar o serviço. O guia de instalação real, para Ubuntu na VPS, está em
`deploy_vps_postgresql.md`.

---

## 4. O que falta fazer

O destino é PostgreSQL 16 na própria VPS, acessado com `pg` + SQL puro (sem ORM, sem build
step), migrado em fases reversíveis. O plano completo está em
`~/.claude/plans/estruture-um-banco-de-functional-wreath.md`.

### 4.1 Por que Postgres resolve, e não só "arrumar o JSON"

Os três defeitos deixam de ser possíveis **por construção**, não por disciplina de código:

```sql
-- Defeito nº 1: a venda duplicada passa a ser rejeitada pelo banco
CREATE UNIQUE INDEX transactions_order_devno_approved_uniq
  ON transactions (order_id, devno) WHERE status = 'APPROVED';

-- Defeito nº 3: grafia inválida não entra
mode TEXT NOT NULL CHECK (mode IN ('BASICA','INTERMEDIARIA','AVANCADA'))

-- Defeito nº 2: o dia comercial passa a ser explícito, no fuso da operação
CREATE VIEW transactions_business AS
SELECT *, (occurred_at AT TIME ZONE 'America/Fortaleza')::date AS business_date
FROM transactions WHERE status = 'APPROVED';
```

### 4.2 Fases

**Fase 1 — dar forma async ao código, ainda 100% em JSON.**
Cache em memória da linha do totem (`services/liveState.js`) e das agregações do painel
(`services/dashboardCache.js`), wrapper `asyncRoute` + middleware de erro, e a conversão dos
~40 call sites restantes, nesta ordem: `auth.js` → `upus_compat.js` → `admin.js` → cupons de
`api.js` → transações de `api.js` → `cielo.js` por último.

> **A decisão de ordenação mais importante de todo o plano:** converter para async
> **enquanto ainda roda sobre JSON**. `await` em não-promise é no-op, então a conversão
> inteira entra em produção sem Postgres nenhum envolvido. Isso separa os dois riscos — "161
> call sites mudaram de forma" e "o datastore mudou" — de modo que, se algo quebrar, dá para
> saber qual dos dois foi. Fazer os dois juntos torna isso impossível.

O cache da linha inteira do totem (não só da telemetria) mantém **8 métodos síncronos para
sempre** — `getTotem`, `getTotemsList`, `upsertTotem`, `updateTotemConfig`,
`updateHeartbeat`, `markTotemOffline`, `markStaleTotemsOffline`, `recordCycleComplete`. São
~62 call sites que não precisam ser tocados, incluindo **todos os 19 do WebSocket**.

**Fase 2 — Postgres existe: schema, importação e `pending_orders`. ✅ Feita e testada (ver 3.3).**
`npm i pg`, pool preguiçoso com type parsers, runner de migration com advisory lock, e o
script de importação do JSON (normalizando modalidade, fazendo backfill de `owner_id`,
mapeando `DEP-01` → `NULL` e **reportando cada conflito em vez de escolher em silêncio**).

`pending_orders` já é tabela real desde esta fase, antes de qualquer dual-write, porque não
tem contrapartida em JSON — nada a importar, nada a comparar, puramente aditivo. É o que vai
corrigir o pior modo de falha do sistema (cliente cobrado sem estorno após um crash) — mas
só depois que `routes/cielo.js` passar a gravar nela, o que é trabalho da Fase 3.

**Ainda falta desta fase:** o systemd unit e o cron de `pg_dump` na VPS real — testados aqui
só localmente. Hoje não existe process manager nenhum no repositório; adicionar dependência
de banco a um processo que ninguém reinicia é receita de indisponibilidade longa.

**Fase 3 — `dual-json`: JSON manda, Postgres recebe cópia.**
Repositórios, fachada async, roteador de modo e o reconciliador que compara os dois bancos a
cada 60s. Endpoint `GET /api/v1/admin/_migration/status` para acompanhar.

*Portão para avançar:* dias consecutivos sem divergência em transações, cupons e alertas,
com os agregados de dinheiro batendo ao centavo.

**Fase 4 — `dual-pg`: Postgres manda, JSON ainda é escrito.**
As leituras invertem. Aqui entram as mudanças deliberadas de comportamento, cada uma em
commit próprio: **correção do fuso (defeito nº 2)**, remoção do teto de 1000 transações e
reescrita do `getStats` como agregação única.

**Fase 5 — `pg`: para de escrever JSON.**
Só depois do exportador reverso escrito **e exercitado**, com snapshot arquivado na virada.

**Fase 6 — limpeza.**
Remove o motor JSON, o dual-write e o `STORE_MODE`. Tira `data/*.json` do git.

### 4.3 Rollback

| De | Para | Como | Custo |
|---|---|---|---|
| `dual-json` | `json` | variável de ambiente + restart | instantâneo, zero perda |
| `dual-pg` | `dual-json` | variável de ambiente + restart | instantâneo, zero perda |
| `pg` | `json` | roda o exportador, troca a variável, restart | minutos |

Ir e voltar entre os dois modos duais é seguro **porque os dois bancos ficam atualizados nos
dois modos**. É exatamente por isso que existem dois modos duais em vez de um.

---

## 5. Schema

Definido em `db/migrations/001_initial_schema.sql`. Doze tabelas (`branches`, `users`,
`depots`, `totems`, `totem_payment_credentials`, `transactions`, `alerts`,
`alert_comments`, `coupons`, `coupon_redemptions`, `pending_orders`, `system_settings`) e a
view `transactions_business`. Princípios: chave de negócio real como `UNIQUE`, dinheiro em
centavos inteiros (nunca float), tempo em `TIMESTAMPTZ`, e o que hoje é string denormalizada
vira chave estrangeira.

Decisões que valem explicação:

- **`totems.owner` (a string com o nome do dono) desaparece.** O RBAC hoje usa um OR de três
  vias (`owner_id` OU `owner === responsible_name` OU `owner === username`). Colapsa para
  `owner_id` como FK, com backfill único na importação.
- **`depots.devno` desaparece.** A relação totem↔ponto é escrita hoje nos dois lados e
  dessincroniza. Fica só `totems.depotno`, com índice único parcial.
- **`revenueToday` e `totalCyclesToday` não são migradas.** São contadores vitalícios com
  nome errado que nunca zeram — o próprio código já as ignora e recalcula das transações.
- **Credenciais Cielo saem para `totem_payment_credentials`.** O mascaramento por perfil vira
  "não dar SELECT na tabela", em vez de apagar campos do objeto depois de já os ter lido.
- **`coupons` ganha `CHECK (current_usages <= max_usages)`**, que junto de um UPDATE
  condicional torna o sobre-resgate impossível mesmo sob concorrência.
- **`alerts.severity` e `alerts.priority` são separadas.** Hoje `openMaintenanceOrder` grava
  a prioridade (`"Média"`) dentro de `severity`, misturando dois vocabulários na mesma coluna.

### Armadilha específica deste código

**`pg` devolve `NUMERIC` e `BIGINT` como string JavaScript.** O `getStats` sobrevive porque
faz `Number(t.amount)`. Mas o `getIncomeReport` faz `(revenue * dep.commissionPercent) / 100`,
e um `SUM(amount)` voltando como `"357.00"` dentro de um `reduce` que começa em `0` produz
`"0357.00"` — concatenação de string silenciosa **no relatório de comissão dos pontos**.
Registrado em `db/pool.js`, na primeira linha depois do `require('pg')`, com teste
explícito confirmando `0 + valor === 357` (não `"0357"`).

### Problemas de integridade encontrados testando com dados reais

O papel do schema é impedir esses defeitos daqui pra frente; o papel do importador
(`scripts/import_json.js`) é não deixá-los travar a carga do histórico que já existe. Ver a
seção 3.3 para a tabela completa — em resumo: `depotno` duplicado apontando para pontos
físicos diferentes, `id` de alerta colidido entre dois eventos reais, e `depotna` genérico
escondendo o nome real do ponto em todos os 13 pontos de produção. Nenhum desses três teria
aparecido só lendo o schema no papel — só apareceram rodando a importação contra o retrato
real da produção.

---

## 6. Como operar

### 6.1 Atualizar a VPS

```bash
cd /caminho/do/capa_cloud
git pull origin main
# reiniciar o processo (pm2 restart / systemctl restart / conforme estiver configurado)
```

**Confirmar que a correção de duplicação está ativa:** depois de algumas vendas novas,
rodar `node scripts/dedupe_transactions.js` (modo simulação). Se ele reportar duplicatas com
data posterior ao restart, a correção **não** está valendo.

### 6.2 Limpar as duplicatas já gravadas

A correção só impede duplicatas novas; as 325 existentes continuam na base e continuam
inflando os relatórios históricos.

```bash
node scripts/dedupe_transactions.js            # simula, não grava nada
node scripts/dedupe_transactions.js --apply    # aplica (faz backup automático antes)
```

### 6.3 Rodar a rede de segurança

```bash
npm run fixture      # reconstrói a fixture da API (precisa de CAPAXERO_LOGIN/SENHA)
npm test             # compara com os snapshots; sai com código 1 em qualquer diferença
npm run test:update  # regrava os snapshots (só quando a mudança for intencional)
```

### 6.4 Subir o PostgreSQL (Fase 2)

Passo a passo completo em `deploy_vps_postgresql.md`. Resumo:

```bash
npm install                                                # instala o driver pg
npm run db:migrate                                          # aplica db/migrations/*.sql
node scripts/import_json.js data/capaxero_database.json     # simula, não grava nada
node scripts/import_json.js data/capaxero_database.json --apply   # aplica de fato
```

Nada disso muda o que o servidor usa — `server.js` continua lendo o JSON até a Fase 3.
Seguro de rodar a qualquer momento, contra um Postgres vazio.

---

## 7. Pendências que exigem decisão sua

Encontradas durante a investigação, independentes da migração.

### 7.1 `/api/v1/admin/*` está sem autenticação

`middleware/auth.js:58-61` tem o corpo do `requireAdminToken` trocado por `next()`, com o
comentário *"Autenticação desativada conforme solicitado pelo usuário"*.

Verificado ao vivo: uma requisição **sem token nenhum** devolve HTTP 200 e a lista completa
de totens. Isso vale para todas as rotas administrativas — incluindo **destravar porta,
parada de emergência e reboot** — expostas na internet em `capaxero.cloud`.

Parece decisão consciente (provavelmente para destravar o APK ou o painel). Precisa de
confirmação: reativar, ou manter e documentar o motivo?

### 7.2 `data/` está versionado no git

O banco JSON com hashes de senha e o histórico de transações está publicado no repositório
do GitHub. Há também credenciais Cielo hardcoded em `services/database.js:42-43`.

O plano remove `data/*.json` do git na fase 6, mas **o histórico do repositório continua
contendo os dados** — limpar isso exige reescrever o histórico ou rotacionar as credenciais.

### 7.3 A senha do CRPADMIN é reaplicada a cada boot

`services/database.js:192-194`: se a senha do CRPADMIN não confere com o valor hardcoded, ela
é reescrita para ele. **Qualquer troca de senha é desfeita no próximo restart.**

---

## 8. Referência rápida de arquivos

| Arquivo | Papel |
|---|---|
| `services/database.js` | Motor JSON atual. Origem dos defeitos de id, modalidade, cupom e stats |
| `services/store.js` | A costura. Vira roteador de modo e shim de dual-write na fase 3 |
| `services/modes.js` | Único lugar que decide a modalidade canônica |
| `services/ids.js` | Geração de id sem colisão |
| `config/env.js` | Carregamento do `.env`. Precisa ser o primeiro require |
| `services/websocket.js` | Ponto sensível: deve permanecer síncrono via cache |
| `routes/cielo.js` | Caminho do dinheiro. `pending_orders`, lock otimista, watchdog |
| `tests/golden.js` | Rede de segurança de regressão. Rodar após cada mudança |
| `scripts/dedupe_transactions.js` | Limpeza das duplicatas já gravadas |
| `scripts/fetch_prod_dataset.js` | Reconstrói a fixture a partir da API |
| `db/migrations/001_initial_schema.sql` | Schema Postgres — as 3 constraints que resolvem os defeitos originais |
| `db/pool.js` | Pool de conexão. Os type parsers de `NUMERIC`/`BIGINT` moram aqui |
| `db/migrate.js` | Runner de migrations, com advisory lock |
| `scripts/import_json.js` | Importa o JSON para o Postgres, resolvendo as colisões da seção 3.3 |
| `deploy_vps_postgresql.md` | Passo a passo para instalar o Postgres na VPS (Fase 2) |
