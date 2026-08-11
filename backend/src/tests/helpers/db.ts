/**
 * Database fixtures for the test suite.
 *
 * `resetDatabase()` truncates every table and inserts a small, deliberately
 * shaped fixture set. Tests assert against these known values rather than
 * against the development seed, so a change to the demo data can never quietly
 * break the suite — and the numbers in the assertions mean something:
 *
 *   PLENTY  100 in stock, alert 10   comfortable
 *   LOW       5 in stock, alert 20   below the threshold
 *   ZERO      0 in stock, alert  5   out of stock (and therefore also "low")
 *   EXACT    10 in stock, alert 10   exactly AT the threshold — `<=`, so low
 *
 * The customers cover the same idea for follow-ups: one overdue, one due
 * exactly today, one in the future, one with none at all.
 */
import { pool, query, withTransaction } from '../../config/db';

/** Re-exported so a test can assert against the tables directly when the API
 *  deliberately hides something — a soft-deleted row, for instance. */
export { query };
import { runMigrations } from '../../db/migrate';
import { hashPassword } from '../../utils/password';
import type { Role } from '../../types/domain';

export const TEST_PASSWORD = 'Test@12345';

export interface Fixtures {
  users: Record<'admin' | 'sales' | 'warehouse' | 'accounts' | 'inactive', number>;
  customers: Record<'active' | 'dueYesterday' | 'dueToday' | 'future' | 'noFollowUp', number>;
  products: Record<'plenty' | 'low' | 'zero' | 'exact', number>;
}

/** Returns a YYYY-MM-DD string `days` from today. */
export function dateFromToday(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

let migrated = false;

/**
 * Applies migrations once per process, then truncates and re-seeds.
 *
 * TRUNCATE … RESTART IDENTITY CASCADE resets the BIGSERIAL counters too, so
 * every run starts from id 1 and the fixture ids are stable. The challan
 * sequence is separate and has to be restarted by name.
 */
export async function resetDatabase(): Promise<Fixtures> {
  if (!migrated) {
    await runMigrations();
    migrated = true;
  }

  await query(`
    TRUNCATE TABLE
      sales_challan_items, sales_challans, stock_movements,
      customer_follow_ups, customers, products, users
    RESTART IDENTITY CASCADE
  `);
  await query('ALTER SEQUENCE challan_number_seq RESTART WITH 1');

  return seedFixtures();
}

async function seedFixtures(): Promise<Fixtures> {
  const passwordHash = await hashPassword(TEST_PASSWORD);

  return withTransaction(async (client) => {
    async function insertUser(
      name: string,
      email: string,
      role: Role,
      isActive = true,
    ): Promise<number> {
      const result = await client.query<{ id: string }>(
        `INSERT INTO users (name, email, password_hash, role, is_active)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [name, email, passwordHash, role, isActive],
      );
      return Number(result.rows[0]!.id);
    }

    const users = {
      admin: await insertUser('Test Admin', 'admin@test.local', 'ADMIN'),
      sales: await insertUser('Test Sales', 'sales@test.local', 'SALES'),
      warehouse: await insertUser('Test Warehouse', 'warehouse@test.local', 'WAREHOUSE'),
      accounts: await insertUser('Test Accounts', 'accounts@test.local', 'ACCOUNTS'),
      // Same password, same ADMIN role — the only difference is is_active, which
      // is what makes it a clean test of the deactivation rule.
      inactive: await insertUser('Test Inactive', 'inactive@test.local', 'ADMIN', false),
    };

    async function insertCustomer(
      name: string,
      mobile: string,
      businessName: string,
      status: string,
      followUpDate: string | null,
    ): Promise<number> {
      const result = await client.query<{ id: string }>(
        `INSERT INTO customers
           (name, mobile, email, business_name, customer_type, address, status,
            follow_up_date, created_by)
         VALUES ($1, $2, $3, $4, 'WHOLESALE', '12 Test Street, Test City 400001', $5, $6, $7)
         RETURNING id`,
        [
          name,
          mobile,
          `${mobile}@test.local`,
          businessName,
          status,
          followUpDate,
          users.admin,
        ],
      );
      return Number(result.rows[0]!.id);
    }

    const customers = {
      active: await insertCustomer('Alpha Buyer', '9000000001', 'Alpha Trading', 'ACTIVE', null),
      dueYesterday: await insertCustomer(
        'Beta Buyer',
        '9000000002',
        'Beta Supplies',
        'LEAD',
        dateFromToday(-1),
      ),
      dueToday: await insertCustomer(
        'Gamma Buyer',
        '9000000003',
        'Gamma Works',
        'ACTIVE',
        dateFromToday(0),
      ),
      future: await insertCustomer(
        'Delta Buyer',
        '9000000004',
        'Delta Holdings',
        'LEAD',
        dateFromToday(7),
      ),
      noFollowUp: await insertCustomer(
        'Epsilon Buyer',
        '9000000005',
        'Epsilon Retail',
        'INACTIVE',
        null,
      ),
    };

    async function insertProduct(
      name: string,
      sku: string,
      unitPrice: string,
      stock: number,
      minStockAlert: number,
    ): Promise<number> {
      const result = await client.query<{ id: string }>(
        `INSERT INTO products
           (name, sku, category, unit_price, min_stock_alert, location, created_by)
         VALUES ($1, $2, 'Testing', $3, $4, 'Test Rack', $5)
         RETURNING id`,
        [name, sku, unitPrice, minStockAlert, users.warehouse],
      );
      const id = Number(result.rows[0]!.id);

      // Stock arrives through the ledger, never by writing current_stock
      // directly — the same rule the application obeys. A product that starts
      // at zero gets no movement at all.
      if (stock > 0) {
        await client.query(
          `INSERT INTO stock_movements
             (product_id, movement_type, quantity, reason, balance_after, reference_type, created_by)
           VALUES ($1, 'IN', $2, 'Opening stock', $2, 'MANUAL', $3)`,
          [id, stock, users.warehouse],
        );
        await client.query('UPDATE products SET current_stock = $1 WHERE id = $2', [stock, id]);
      }

      return id;
    }

    const products = {
      plenty: await insertProduct('Plenty Widget', 'PLENTY-1', '100.00', 100, 10),
      low: await insertProduct('Low Widget', 'LOW-1', '250.50', 5, 20),
      zero: await insertProduct('Zero Widget', 'ZERO-1', '75.25', 0, 5),
      exact: await insertProduct('Exact Widget', 'EXACT-1', '10.00', 10, 10),
    };

    return { users, customers, products };
  });
}

/** Reads a product's authoritative stock figure straight from the table. */
export async function stockOf(productId: number): Promise<number> {
  const result = await query<{ current_stock: number }>(
    'SELECT current_stock FROM products WHERE id = $1',
    [productId],
  );
  return result.rows[0]?.current_stock ?? -1;
}

/** Counts ledger rows for a product — used to prove nothing was written. */
export async function movementCount(productId: number): Promise<number> {
  const result = await query<{ count: string }>(
    'SELECT count(*) AS count FROM stock_movements WHERE product_id = $1',
    [productId],
  );
  return Number(result.rows[0]?.count ?? 0);
}

export async function closeDatabase(): Promise<void> {
  await pool.end();
}
