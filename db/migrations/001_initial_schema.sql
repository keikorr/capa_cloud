-- Capaxero Cloud — Schema inicial PostgreSQL
--
-- Migra o modelo de dados hoje mantido em data/capaxero_database.json (um único arquivo
-- JSON reescrito por inteiro a cada mutação, sem constraints) para tabelas relacionais.
--
-- Três constraints resolvem, por construção, os defeitos que causaram a divergência
-- original de vendas e ciclos no painel:
--   1) transactions_order_devno_approved_uniq  -> venda duplicada não entra mais
--   2) mode CHECK                              -> grafia inválida de modalidade não entra
--   3) transactions_business (view)            -> dia comercial no fuso da operação, não UTC
--
-- Convenções:
--   - Chave de negócio real (devno, depotno, branno, code, id de usuário) como PRIMARY KEY,
--     igual ao que o código já usa como chave em toda parte — evita remapear todo join site.
--   - transactions e alerts usam PK substituta (IDENTITY) + public_id, porque os ids do
--     JSON coexistem com os novos: linhas antigas mantêm "TX-######", linhas novas ganham o
--     formato de services/ids.js.
--   - Dinheiro em centavos (INTEGER), nunca float.
--   - Tempo em TIMESTAMPTZ.
--   - config e blobs operacionais genuinamente aninhados (modos de higienização, ciclo em
--     andamento) ficam em JSONB — não há bug de correção financeira escondido ali, e
--     explodir em dezenas de colunas não traria benefício agora.
--
-- Sem BEGIN/COMMIT neste arquivo: db/migrate.js executa cada migration inteira dentro de
-- uma transação que também grava a linha em schema_migrations, para que "aplicada" e
-- "registrada como aplicada" nunca fiquem inconsistentes entre si.

-- Necessário para gen_random_uuid() em coupon_redemptions
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Aplicado nas tabelas com updated_at: idioma SQL padrão, não é "mágica de ORM" —
-- só remove a classe de bug "esqueci de atualizar updated_at" do código futuro dos
-- repositórios.
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ═══════════════════════════════════════════════════════════════════════════
-- BRANCHES
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE branches (
  branno      TEXT PRIMARY KEY,
  branna      TEXT NOT NULL DEFAULT 'Filial Regional',
  cocode      TEXT NOT NULL DEFAULT 'CAPAXERO',
  compno      TEXT NOT NULL DEFAULT '87550094',
  manager     TEXT,
  phone       TEXT,
  active      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ═══════════════════════════════════════════════════════════════════════════
-- USERS
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE users (
  id                TEXT PRIMARY KEY,
  username          TEXT NOT NULL,
  email             TEXT NOT NULL,
  password_hash     TEXT NOT NULL,
  role              TEXT NOT NULL CHECK (role IN ('CRPADMIN', 'OWNER')),
  cnpj              TEXT,
  -- Coluna derivada só de dígitos, para reproduzir o dedupe que o app já faz hoje
  -- (compara CNPJ ignorando máscara). Índice único parcial abaixo usa esta coluna.
  cnpj_digits       TEXT GENERATED ALWAYS AS (regexp_replace(coalesce(cnpj, ''), '\D', '', 'g')) STORED,
  responsible_name  TEXT NOT NULL,
  phone             TEXT,
  company_name      TEXT,
  franchise_type    TEXT CHECK (franchise_type IN ('PROPRIA', 'FRANQUEADO')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- authenticateUser() já compara e-mail em minúsculas e o app sempre grava lowercased;
-- username é comparado case-insensitive no login (ex.: 'CRPADMIN'), por isso o índice
-- funcional em vez de UNIQUE direto na coluna.
CREATE UNIQUE INDEX users_email_uniq ON users (email);
CREATE UNIQUE INDEX users_username_lower_uniq ON users (lower(username));
CREATE UNIQUE INDEX users_cnpj_digits_uniq ON users (cnpj_digits) WHERE cnpj_digits <> '';

CREATE TRIGGER users_set_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- DEPOTS (pontos de instalação)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE depots (
  depotno               TEXT PRIMARY KEY,
  depotna               TEXT NOT NULL DEFAULT 'Ponto de Instalação',
  branno                TEXT REFERENCES branches(branno) ON DELETE SET NULL,
  address                TEXT NOT NULL DEFAULT '',
  contact_person         TEXT NOT NULL DEFAULT '',
  phone                  TEXT NOT NULL DEFAULT '',
  daily_traffic_motos    INTEGER NOT NULL DEFAULT 0,
  commission_percent     NUMERIC(5,2) NOT NULL DEFAULT 0,
  lat                    NUMERIC(10,7),
  lng                    NUMERIC(10,7),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ═══════════════════════════════════════════════════════════════════════════
-- TOTEMS
--
-- totems.owner (string denormalizada com o nome do dono) foi eliminada: o RBAC hoje usa
-- um OR de três vias (owner_id OU owner === responsible_name OU owner === username), que
-- colapsa para owner_id como FK real, com backfill único na importação.
--
-- depots.devno (a outra ponta da relação totem↔ponto, escrita nos dois lados hoje e
-- responsável por dessincronizar) também foi eliminada: só totems.depotno existe, e o
-- índice único parcial abaixo garante 1 totem por ponto.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE totems (
  devno                 TEXT PRIMARY KEY,
  name                  TEXT NOT NULL,
  location               TEXT NOT NULL DEFAULT 'Ponto a Cadastrar',
  depotno                TEXT REFERENCES depots(depotno) ON DELETE SET NULL,
  branno                 TEXT REFERENCES branches(branno) ON DELETE SET NULL,
  owner_id               TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  box_count               INTEGER NOT NULL DEFAULT 1,
  status                 TEXT NOT NULL DEFAULT 'IDLE'
                           CHECK (status IN ('IDLE', 'CLEANING', 'MAINTENANCE', 'ERROR', 'OFFLINE')),
  liquid_level_percent    SMALLINT NOT NULL DEFAULT 100
                           CHECK (liquid_level_percent BETWEEN 0 AND 100),
  door_locked             BOOLEAN NOT NULL DEFAULT true,
  last_heartbeat          TIMESTAMPTZ,
  -- Ciclo em andamento (step, progresso, orderId) — operacional, transiente por natureza.
  current_cycle           JSONB,
  -- Preços, durações e parâmetros de cada modalidade (basica/intermediaria/avancada),
  -- flags de pagamento habilitado, URL de vídeo etc. Sem credenciais Cielo — essas ficam
  -- em totem_payment_credentials, para que o mascaramento por perfil vire "não dar SELECT
  -- na tabela" em vez de apagar campos de um objeto já lido.
  config                  JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX totems_depotno_uniq ON totems (depotno) WHERE depotno IS NOT NULL;
CREATE INDEX totems_owner_id_idx ON totems (owner_id);

CREATE TRIGGER totems_set_updated_at
  BEFORE UPDATE ON totems
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Credenciais de pagamento por totem (Cielo Conecta / Pinpad + Cielo E-Commerce/PIX).
-- 1:1 com totems. Separada para que CRPADMIN vs OWNER seja controlado por permissão de
-- SELECT na tabela, e não por apagar campos do objeto já carregado (como getTotemsList()
-- faz hoje).
CREATE TABLE totem_payment_credentials (
  devno                             TEXT PRIMARY KEY REFERENCES totems(devno) ON DELETE CASCADE,
  pinpad_license                    TEXT NOT NULL DEFAULT '',
  pinpad_company                    TEXT NOT NULL DEFAULT '',
  pinpad_comm                       TEXT NOT NULL DEFAULT 'USB',
  conecta_environment                TEXT NOT NULL DEFAULT 'Sandbox'
                                       CHECK (conecta_environment IN ('Sandbox', 'Homologacao', 'Producao')),
  conecta_client_id                  TEXT NOT NULL DEFAULT '',
  conecta_client_secret              TEXT NOT NULL DEFAULT '',
  conecta_subordinated_merchant_id    TEXT NOT NULL DEFAULT '',
  conecta_terminal_id                TEXT NOT NULL DEFAULT '',
  conecta_card_timeout_seconds        INTEGER NOT NULL DEFAULT 90,
  ecommerce_environment              TEXT NOT NULL DEFAULT 'Producao'
                                       CHECK (ecommerce_environment IN ('Sandbox', 'Homologacao', 'Producao')),
  ecommerce_merchant_id              TEXT NOT NULL DEFAULT '',
  ecommerce_merchant_key             TEXT NOT NULL DEFAULT '',
  pix_expiration_seconds             INTEGER NOT NULL DEFAULT 180,
  updated_at                         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER totem_payment_credentials_set_updated_at
  BEFORE UPDATE ON totem_payment_credentials
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- TRANSACTIONS — a tabela que resolve a queixa original
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE transactions (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id       TEXT NOT NULL UNIQUE,           -- "TX-######" legado ou o novo formato de ids.js
  order_id        TEXT NOT NULL,
  devno           TEXT NOT NULL REFERENCES totems(devno) ON DELETE RESTRICT,
  status          TEXT NOT NULL DEFAULT 'APPROVED'
                    CHECK (status IN ('APPROVED', 'DENIED', 'REVERSED')),
  mode            TEXT NOT NULL
                    CHECK (mode IN ('BASICA', 'INTERMEDIARIA', 'AVANCADA')),
  mode_label      TEXT,                            -- grafia de exibição como recebida ("Intermediária")
  amount_cents    INTEGER NOT NULL CHECK (amount_cents >= 0),
  payment_method  TEXT NOT NULL,
  card_brand      TEXT,
  nsu             TEXT,
  auth_code       TEXT,
  occurred_at     TIMESTAMPTZ NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Defeito nº 1: a venda duplicada passa a ser rejeitada pelo próprio banco, não por uma
-- checagem em JS que um segundo caminho de código podia esquecer de chamar.
CREATE UNIQUE INDEX transactions_order_devno_approved_uniq
  ON transactions (order_id, devno) WHERE status = 'APPROVED';

CREATE INDEX transactions_devno_occurred_idx
  ON transactions (devno, occurred_at DESC) WHERE status = 'APPROVED';

CREATE INDEX transactions_occurred_idx
  ON transactions (occurred_at DESC) WHERE status = 'APPROVED';

-- Defeito nº 2: o dia comercial passa a ser explícito, calculado no fuso da operação
-- (Fortaleza, UTC-3, sem horário de verão) em vez de UTC. As três funções que hoje fazem
-- new Date().toISOString().slice(0,10) — getTodayMetrics, getStats, getIncomeReport —
-- migram para consultar business_date aqui.
CREATE VIEW transactions_business AS
SELECT
  *,
  (occurred_at AT TIME ZONE 'America/Fortaleza')::date AS business_date
FROM transactions
WHERE status = 'APPROVED';

-- ═══════════════════════════════════════════════════════════════════════════
-- ALERTS
--
-- severity e priority foram separadas: hoje openMaintenanceOrder grava a prioridade
-- ("Média") dentro de severity, misturando dois vocabulários na mesma coluna.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE alerts (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id     TEXT NOT NULL UNIQUE,             -- "ALT-#####" legado ou o novo formato
  devno         TEXT NOT NULL REFERENCES totems(devno) ON DELETE CASCADE,
  type          TEXT NOT NULL,                     -- LOW_LIQUID, MAINTENANCE, SENSOR_WARNING, livre
  severity      TEXT,                              -- WARNING / CRITICAL
  priority      TEXT,                               -- só ordens de manutenção: Alta/Média/Baixa
  issue_type    TEXT,                               -- só ordens de manutenção
  assignee      TEXT,
  message       TEXT NOT NULL DEFAULT '',
  resolved      BOOLEAN NOT NULL DEFAULT false,
  resolved_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX alerts_devno_idx ON alerts (devno);
CREATE INDEX alerts_unresolved_idx ON alerts (devno) WHERE resolved = false;

CREATE TABLE alert_comments (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id   TEXT NOT NULL UNIQUE,               -- "CMT-######" legado ou o novo formato
  alert_id    BIGINT NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
  text        TEXT NOT NULL,
  author      TEXT NOT NULL DEFAULT 'Admin',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX alert_comments_alert_id_idx ON alert_comments (alert_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- COUPONS
--
-- current_usages <= max_usages, junto do UPDATE condicional que o repositório fará
-- (UPDATE ... SET current_usages = current_usages + 1 WHERE current_usages < max_usages),
-- torna o sobre-resgate impossível mesmo sob concorrência — a versão atual em JS é um
-- read-check-write sem lock nenhum.
--
-- isUsed / usedAt / usedByTotem / lastUsedMode / lastOrderId do JSON são todos deriváveis
-- de current_usages e da última linha de coupon_redemptions — não viram coluna.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE coupons (
  code                 TEXT PRIMARY KEY,
  description          TEXT NOT NULL DEFAULT '',
  discount_percent     SMALLINT NOT NULL DEFAULT 10 CHECK (discount_percent BETWEEN 1 AND 100),
  applicable_mode      TEXT CHECK (applicable_mode IN ('BASICA', 'INTERMEDIARIA', 'AVANCADA')),
  allowed_totems       TEXT[],                     -- NULL = vale para toda a rede
  max_usages           INTEGER NOT NULL DEFAULT 1,
  max_usages_per_cpf   INTEGER NOT NULL DEFAULT 1,
  require_cpf          BOOLEAN NOT NULL DEFAULT true,
  current_usages       INTEGER NOT NULL DEFAULT 0,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT coupons_usage_within_limit CHECK (current_usages <= max_usages)
);

CREATE TRIGGER coupons_set_updated_at
  BEFORE UPDATE ON coupons
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE coupon_redemptions (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coupon_code              TEXT NOT NULL REFERENCES coupons(code) ON DELETE CASCADE,
  cpf                      TEXT,                    -- 11 dígitos, sem máscara; vazio quando não exigido
  cpf_formatted            TEXT,
  redeemed_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  totem_devno              TEXT REFERENCES totems(devno) ON DELETE SET NULL,
  selected_mode            TEXT,
  order_id                 TEXT,
  discount_percent         SMALLINT NOT NULL,
  discount_applied_cents   INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX coupon_redemptions_coupon_code_idx ON coupon_redemptions (coupon_code);
-- Consulta do limite por CPF (countCpfUsages). NÃO é UNIQUE: max_usages_per_cpf varia por
-- cupom (não é sempre 1), então a checagem de limite continua sendo feita no repositório.
CREATE INDEX coupon_redemptions_coupon_cpf_idx ON coupon_redemptions (coupon_code, cpf) WHERE cpf IS NOT NULL AND cpf <> '';

-- ═══════════════════════════════════════════════════════════════════════════
-- PENDING_ORDERS
--
-- Hoje é um Map em memória (services/database.js), nunca persistido — um crash entre a
-- autorização da Cielo e a confirmação local (/card/finish) perde o registro e o cliente
-- fica cobrado sem estorno. É o pior modo de falha do sistema, e vira tabela real já na
-- fase 2, antes de qualquer outra migração, porque não tem contrapartida em JSON: nada a
-- importar, nada a comparar, puramente aditivo.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE pending_orders (
  order_id              TEXT PRIMARY KEY,
  merchant_order_id     TEXT,
  devno                 TEXT NOT NULL REFERENCES totems(devno) ON DELETE RESTRICT,
  mode                  TEXT,
  amount_cents          INTEGER NOT NULL,
  payment_method        TEXT,
  status                TEXT NOT NULL DEFAULT 'WAITING_PAYMENT'
                          CHECK (status IN (
                            'WAITING_PAYMENT', 'WAITING_CARD', 'CHECKING',
                            'APPROVED', 'DENIED', 'EXPIRED', 'REVERSED'
                          )),
  payment_id            TEXT,
  is_real_cielo         BOOLEAN NOT NULL DEFAULT false,
  qr_code_pix           TEXT,
  qr_code_base64        TEXT,
  is_demo_qr_code       BOOLEAN NOT NULL DEFAULT false,
  cielo_environment     TEXT,
  expires_at            TIMESTAMPTZ,
  expires_in_seconds    INTEGER,
  pinpad_command        JSONB,
  finance_confirmed     BOOLEAN NOT NULL DEFAULT false,
  authorized_at         TIMESTAMPTZ,
  nsu                   TEXT,
  auth_code             TEXT,
  card_brand            TEXT,
  emv_response_data     JSONB,
  raw_auth_result       JSONB,
  final_result          JSONB,
  reversal_reason       TEXT,
  error                 TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Webhook da Cielo busca por paymentId (routes/cielo.js:457 fazia varredura linear do Map
-- inteiro); watchdog de estorno busca por status+authorizedAt (routes/cielo.js:815).
CREATE INDEX pending_orders_payment_id_idx ON pending_orders (payment_id) WHERE payment_id IS NOT NULL;
CREATE INDEX pending_orders_watchdog_idx ON pending_orders (status, authorized_at)
  WHERE status = 'APPROVED' AND finance_confirmed = false;

CREATE TRIGGER pending_orders_set_updated_at
  BEFORE UPDATE ON pending_orders
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- SYSTEM_SETTINGS — linha única (singleton)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE system_settings (
  id                            SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  default_cielo_merchant_id     TEXT NOT NULL DEFAULT '',
  default_cielo_merchant_key    TEXT NOT NULL DEFAULT '',
  cielo_overrides                JSONB,             -- bloco cielo{} raramente usado, aninhado no JSON original
  updated_at                    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER system_settings_set_updated_at
  BEFORE UPDATE ON system_settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

INSERT INTO system_settings (id) VALUES (1);
