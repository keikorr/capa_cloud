-- Funcionários cadastrados por donos de Máquina Própria (papel EMPLOYEE).
--
-- Moram na mesma tabela users (mesmo login, hash de senha e sessão), com:
--   employer_id     dono que cadastrou o funcionário (sai junto quando o dono é excluído)
--   all_machines    true = enxerga todas as máquinas do dono
--   allowed_devnos  máquinas liberadas quando all_machines = false
--   permissions     { viewRevenue, remoteCommands, configureMachine, couponsMaintenance }
--   active          false bloqueia o login sem apagar o cadastro
--
-- Sem BEGIN/COMMIT: db/migrate.js já envolve cada migration numa transação.

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('CRPADMIN', 'OWNER', 'EMPLOYEE'));

ALTER TABLE users
  ADD COLUMN employer_id     TEXT REFERENCES users(id) ON DELETE CASCADE,
  ADD COLUMN all_machines    BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN allowed_devnos  JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN permissions     JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN active          BOOLEAN NOT NULL DEFAULT true;

-- Todo funcionário tem dono; donos e admin não têm.
ALTER TABLE users ADD CONSTRAINT users_employee_has_employer
  CHECK ((role = 'EMPLOYEE') = (employer_id IS NOT NULL));

CREATE INDEX users_employer_id_idx ON users (employer_id) WHERE employer_id IS NOT NULL;
