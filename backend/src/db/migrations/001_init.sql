-- =============================================================================
-- 001_init.sql — initial schema for the Mini ERP + CRM Operations Portal
--
-- Implements docs/DATABASE_DESIGN.md. Applied by `npm run migrate`, which wraps
-- this file in a single transaction: it either lands completely or not at all.
--
-- The `schema_migrations` bookkeeping table is NOT created here — migrate.ts
-- creates it before reading the applied-migrations list, because that read has
-- to work on a completely empty database.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- Shared trigger: keeps updated_at honest so no UPDATE can forget to bump it.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- -----------------------------------------------------------------------------
-- 1. users — employee accounts. Seeded, never self-registered.
-- -----------------------------------------------------------------------------
CREATE TABLE users (
  id            BIGSERIAL PRIMARY KEY,
  name          TEXT        NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 120),
  email         TEXT        NOT NULL
                            CHECK (email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[a-z]{2,}$'),
  password_hash TEXT        NOT NULL,
  role          TEXT        NOT NULL CHECK (role IN ('ADMIN','SALES','WAREHOUSE','ACCOUNTS')),
  is_active     BOOLEAN     NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Case-insensitive uniqueness without needing the citext extension, which not
-- every managed provider grants permission to install.
CREATE UNIQUE INDEX uq_users_email_lower ON users (lower(email));

CREATE TRIGGER trg_users_updated BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- -----------------------------------------------------------------------------
-- 2. customers — CRM master. Soft-deleted so challan history survives.
-- -----------------------------------------------------------------------------
CREATE TABLE customers (
  id             BIGSERIAL PRIMARY KEY,
  name           TEXT        NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 120),
  mobile         TEXT        NOT NULL UNIQUE CHECK (mobile ~ '^[0-9]{10,15}$'),
  email          TEXT        NOT NULL
                             CHECK (email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[a-z]{2,}$'),
  business_name  TEXT        NOT NULL CHECK (length(btrim(business_name)) BETWEEN 2 AND 150),
  gst_number     TEXT        NULL CHECK (
                   gst_number IS NULL OR
                   gst_number ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$'),
  customer_type  TEXT        NOT NULL CHECK (customer_type IN ('RETAIL','WHOLESALE','DISTRIBUTOR')),
  address        TEXT        NOT NULL CHECK (length(btrim(address)) BETWEEN 5 AND 500),
  status         TEXT        NOT NULL DEFAULT 'LEAD'
                             CHECK (status IN ('LEAD','ACTIVE','INACTIVE')),
  follow_up_date DATE        NULL,
  notes          TEXT        NULL CHECK (notes IS NULL OR length(notes) <= 2000),
  created_by     BIGINT      NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  deleted_at     TIMESTAMPTZ NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_customers_updated BEFORE UPDATE ON customers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_customers_status         ON customers (status)        WHERE deleted_at IS NULL;
CREATE INDEX idx_customers_type           ON customers (customer_type) WHERE deleted_at IS NULL;
CREATE INDEX idx_customers_follow_up      ON customers (follow_up_date)
  WHERE deleted_at IS NULL AND follow_up_date IS NOT NULL;
CREATE INDEX idx_customers_name_lower     ON customers (lower(name));
CREATE INDEX idx_customers_business_lower ON customers (lower(business_name));
CREATE INDEX idx_customers_created_at     ON customers (created_at DESC);


-- -----------------------------------------------------------------------------
-- 3. customer_follow_ups — append-only CRM activity log.
-- -----------------------------------------------------------------------------
CREATE TABLE customer_follow_ups (
  id                  BIGSERIAL PRIMARY KEY,
  customer_id         BIGINT      NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  note                TEXT        NOT NULL CHECK (length(btrim(note)) BETWEEN 1 AND 2000),
  next_follow_up_date DATE        NULL,
  created_by          BIGINT      NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_follow_ups_customer ON customer_follow_ups (customer_id, created_at DESC);


-- -----------------------------------------------------------------------------
-- 4. products — product master and the authoritative stock figure.
-- -----------------------------------------------------------------------------
CREATE TABLE products (
  id              BIGSERIAL PRIMARY KEY,
  name            TEXT          NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 150),
  sku             TEXT          NOT NULL UNIQUE CHECK (sku ~ '^[A-Za-z0-9_-]{2,50}$'),
  category        TEXT          NOT NULL CHECK (length(btrim(category)) BETWEEN 2 AND 80),
  unit_price      NUMERIC(12,2) NOT NULL CHECK (unit_price >= 0),
  -- The negative-stock guarantee. This constraint holds even if the service
  -- layer has a bug: the transaction aborts rather than persisting bad stock.
  current_stock   INTEGER       NOT NULL DEFAULT 0 CHECK (current_stock >= 0),
  min_stock_alert INTEGER       NOT NULL DEFAULT 0 CHECK (min_stock_alert >= 0),
  location        TEXT          NOT NULL CHECK (length(btrim(location)) BETWEEN 1 AND 100),
  is_active       BOOLEAN       NOT NULL DEFAULT true,
  created_by      BIGINT        NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_products_updated BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_products_category   ON products (category);
CREATE INDEX idx_products_active     ON products (is_active);
CREATE INDEX idx_products_name_lower ON products (lower(name));


-- -----------------------------------------------------------------------------
-- 5. stock_movements — append-only inventory ledger. Never updated or deleted.
-- -----------------------------------------------------------------------------
CREATE TABLE stock_movements (
  id             BIGSERIAL PRIMARY KEY,
  product_id     BIGINT      NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  movement_type  TEXT        NOT NULL CHECK (movement_type IN ('IN','OUT')),
  -- Always a positive magnitude; the direction lives in movement_type.
  quantity       INTEGER     NOT NULL CHECK (quantity > 0),
  reason         TEXT        NOT NULL CHECK (length(btrim(reason)) BETWEEN 3 AND 255),
  balance_after  INTEGER     NOT NULL CHECK (balance_after >= 0),
  -- NOT NULL on purpose: a CHECK expression that evaluates to NULL is treated
  -- as satisfied, so a nullable reference_type would let a row carry a
  -- reference_id with no source type at all.
  reference_type TEXT        NOT NULL DEFAULT 'MANUAL'
                             CHECK (reference_type IN ('MANUAL','SALES_CHALLAN')),
  reference_id   BIGINT      NULL,
  created_by     BIGINT      NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_movement_reference
    CHECK ((reference_type = 'SALES_CHALLAN') = (reference_id IS NOT NULL))
);

CREATE INDEX idx_stock_moves_product    ON stock_movements (product_id, created_at DESC);
CREATE INDEX idx_stock_moves_created_at ON stock_movements (created_at DESC);
CREATE INDEX idx_stock_moves_reference  ON stock_movements (reference_type, reference_id);


-- -----------------------------------------------------------------------------
-- 6. sales_challans — challan header and lifecycle.
-- -----------------------------------------------------------------------------
-- nextval() is atomic and non-blocking, so two users creating a challan at the
-- same instant can never receive the same number — unlike SELECT max(...) + 1.
CREATE SEQUENCE challan_number_seq;

CREATE TABLE sales_challans (
  id             BIGSERIAL PRIMARY KEY,
  challan_number TEXT          NOT NULL UNIQUE,
  customer_id    BIGINT        NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  status         TEXT          NOT NULL DEFAULT 'DRAFT'
                               CHECK (status IN ('DRAFT','CONFIRMED','CANCELLED')),
  total_quantity INTEGER       NOT NULL DEFAULT 0 CHECK (total_quantity >= 0),
  total_amount   NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
  notes          TEXT          NULL CHECK (notes IS NULL OR length(notes) <= 1000),
  created_by     BIGINT        NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  confirmed_by   BIGINT        NULL REFERENCES users(id) ON DELETE RESTRICT,
  confirmed_at   TIMESTAMPTZ   NULL,
  cancelled_by   BIGINT        NULL REFERENCES users(id) ON DELETE RESTRICT,
  cancelled_at   TIMESTAMPTZ   NULL,
  created_at     TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ   NOT NULL DEFAULT now(),
  -- A status and its audit stamps can never disagree.
  CONSTRAINT chk_challan_confirmed
    CHECK ((status = 'CONFIRMED') = (confirmed_at IS NOT NULL AND confirmed_by IS NOT NULL)),
  CONSTRAINT chk_challan_cancelled
    CHECK ((status = 'CANCELLED') = (cancelled_at IS NOT NULL AND cancelled_by IS NOT NULL))
);

CREATE TRIGGER trg_challans_updated BEFORE UPDATE ON sales_challans
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_challans_customer   ON sales_challans (customer_id, created_at DESC);
CREATE INDEX idx_challans_status     ON sales_challans (status);
CREATE INDEX idx_challans_created_at ON sales_challans (created_at DESC);


-- -----------------------------------------------------------------------------
-- 7. sales_challan_items — challan lines WITH a product snapshot.
--
-- product_name, product_sku and unit_price are copied from the product at the
-- moment of sale and are never updated afterwards. Renaming or repricing a
-- product must not rewrite the document a customer already signed for.
-- product_id is kept alongside so live analytics still work.
-- -----------------------------------------------------------------------------
CREATE TABLE sales_challan_items (
  id           BIGSERIAL PRIMARY KEY,
  challan_id   BIGINT        NOT NULL REFERENCES sales_challans(id) ON DELETE CASCADE,
  product_id   BIGINT        NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  product_name TEXT          NOT NULL,                            -- snapshot
  product_sku  TEXT          NOT NULL,                            -- snapshot
  unit_price   NUMERIC(12,2) NOT NULL CHECK (unit_price >= 0),    -- snapshot
  quantity     INTEGER       NOT NULL CHECK (quantity > 0),
  line_total   NUMERIC(14,2) GENERATED ALWAYS AS (unit_price * quantity) STORED,
  created_at   TIMESTAMPTZ   NOT NULL DEFAULT now(),
  CONSTRAINT uq_challan_product UNIQUE (challan_id, product_id)
);

CREATE INDEX idx_challan_items_challan ON sales_challan_items (challan_id);
