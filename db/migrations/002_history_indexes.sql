-- Índice de apoio ao histórico de vendas por máquina (public/js/app.js, aba "Histórico").
--
-- coupon_redemptions só tinha índice por coupon_code e por (coupon_code, cpf) — a consulta
-- "quais cupons foram resgatados NESTA máquina" (WHERE totem_devno = $1) fazia seq scan da
-- tabela inteira. Parcial em totem_devno IS NOT NULL porque a FK é ON DELETE SET NULL: os
-- órfãos não são alcançáveis por essa consulta e não precisam ocupar o índice. A segunda
-- coluna (redeemed_at DESC) serve o ORDER BY da mesma consulta sem sort extra.
--
-- Sem BEGIN/COMMIT neste arquivo: db/migrate.js já envolve cada migration numa transação
-- junto do INSERT em schema_migrations. Sem CREATE INDEX CONCURRENTLY: não roda dentro de
-- bloco de transação, e falharia sob esse mesmo wrapper — a tabela é pequena o bastante
-- para o lock exclusivo ser momentâneo.

CREATE INDEX coupon_redemptions_totem_devno_idx
  ON coupon_redemptions (totem_devno, redeemed_at DESC)
  WHERE totem_devno IS NOT NULL;
