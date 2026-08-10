-- =============================================================================
-- 002_customer_mobile_partial_unique.sql
--
-- Problem found while testing Phase 3:
--   customers.mobile carried an unconditional UNIQUE constraint, but customers
--   are SOFT deleted (deleted_at). The row therefore survives deletion and keeps
--   holding its mobile number forever, so a number can never be registered
--   again — even though the application considers that customer gone.
--
--   The service layer's duplicate check already ignores soft-deleted rows, so
--   the two disagreed: the service allowed the insert and the database rejected
--   it with a raw constraint violation.
--
-- Fix:
--   Replace the constraint with a PARTIAL unique index covering only live rows.
--   "Unique among customers that still exist" is what the business rule
--   actually says, and it now matches customer.repository.mobileExists exactly.
--
-- Note: a partial index cannot be a UNIQUE CONSTRAINT (constraints have no
-- WHERE clause), so this is a unique INDEX. It enforces uniqueness identically.
-- =============================================================================

ALTER TABLE customers DROP CONSTRAINT customers_mobile_key;

CREATE UNIQUE INDEX uq_customers_mobile_active
  ON customers (mobile)
  WHERE deleted_at IS NULL;
