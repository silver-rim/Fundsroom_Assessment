/**
 * Development seed data.
 *
 * Idempotent: running it twice does not duplicate anything, and it never
 * overwrites a record that already exists. Everything runs in ONE transaction,
 * so a partially-seeded database is not a possible outcome.
 *
 * Two rules this script deliberately obeys, because the application obeys them:
 *   - Opening stock is created through stock_movements, never by writing
 *     current_stock directly. The ledger balances from row one.
 *   - Passwords are bcrypt-hashed here; no plaintext reaches the database.
 *
 *   npm run seed        (development, via tsx)
 *   npm run seed:prod   (after `npm run build`)
 */
import type { PoolClient } from 'pg';
import { env } from '../config/env';
import { pool, withTransaction } from '../config/db';
import { hashPassword } from '../utils/password';
import { logger } from '../utils/logger';
import * as challanRepository from '../repositories/challan.repository';
import type { CustomerStatus, CustomerType, Role } from '../types/domain';

/** Returns a YYYY-MM-DD string `days` from today (negative = in the past). */
function dateFromToday(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

// -----------------------------------------------------------------------------
// Seed definitions
// -----------------------------------------------------------------------------

interface SeedUser {
  name: string;
  email: string;
  role: Role;
  password: string;
}

const SEED_USERS: SeedUser[] = [
  {
    name: 'Asha Menon',
    email: 'admin@fundsroom.local',
    role: 'ADMIN',
    password: env.SEED_ADMIN_PASSWORD,
  },
  {
    name: 'Nikhil Rao',
    email: 'sales@fundsroom.local',
    role: 'SALES',
    password: env.SEED_SALES_PASSWORD,
  },
  {
    name: 'Farid Ali',
    email: 'warehouse@fundsroom.local',
    role: 'WAREHOUSE',
    password: env.SEED_WAREHOUSE_PASSWORD,
  },
  {
    name: 'Meera Iyer',
    email: 'accounts@fundsroom.local',
    role: 'ACCOUNTS',
    password: env.SEED_ACCOUNTS_PASSWORD,
  },
];

interface SeedCustomer {
  name: string;
  mobile: string;
  email: string;
  businessName: string;
  gstNumber: string | null;
  customerType: CustomerType;
  address: string;
  status: CustomerStatus;
  followUpInDays: number | null;
  notes: string | null;
}

const SEED_CUSTOMERS: SeedCustomer[] = [
  {
    name: 'Ramesh Patel',
    mobile: '9876543210',
    email: 'ramesh@sharmatraders.in',
    businessName: 'Sharma Traders',
    gstNumber: '24AAACS1234F1Z5',
    customerType: 'WHOLESALE',
    address: '14 MG Road, Ring Road Market, Surat, Gujarat 395003',
    status: 'ACTIVE',
    followUpInDays: 4,
    notes: 'Prefers delivery before noon. Pays on 30-day terms.',
  },
  {
    name: 'Priya Nair',
    mobile: '9812345678',
    email: 'priya@nairelectric.com',
    businessName: 'Nair Electricals',
    gstNumber: '32AABCN5678K1Z2',
    customerType: 'DISTRIBUTOR',
    address: '7/B Panampilly Nagar, Kochi, Kerala 682036',
    status: 'ACTIVE',
    followUpInDays: 11,
    notes: 'Largest account in the southern region.',
  },
  {
    name: 'Imran Shaikh',
    mobile: '9765432109',
    email: 'imran@shaikhhardware.in',
    businessName: 'Shaikh Hardware',
    gstNumber: null,
    customerType: 'RETAIL',
    address: 'Shop 3, Laxmi Complex, Pune, Maharashtra 411001',
    status: 'LEAD',
    followUpInDays: -2,
    notes: 'Walk-in enquiry. No GST registration yet.',
  },
  {
    name: 'Kavita Deshmukh',
    mobile: '9701234567',
    email: 'kavita@deshmukhent.com',
    businessName: 'Deshmukh Enterprises',
    gstNumber: '27AACCD9876P1ZQ',
    customerType: 'WHOLESALE',
    address: 'Plot 22, MIDC Industrial Area, Nashik, Maharashtra 422007',
    status: 'ACTIVE',
    followUpInDays: 1,
    notes: 'Asked for a quote on switchgear in bulk.',
  },
  {
    name: 'Sunil Verma',
    mobile: '9988776655',
    email: 'sunil@vermaelectricals.in',
    businessName: 'Verma Electricals & Co',
    gstNumber: null,
    customerType: 'RETAIL',
    address: '112 Civil Lines, Kanpur, Uttar Pradesh 208001',
    status: 'INACTIVE',
    followUpInDays: null,
    notes: 'Dormant since last year. Do not prioritise.',
  },
  {
    name: 'Anjali Rao',
    mobile: '9090909090',
    email: 'anjali@raodistribution.com',
    businessName: 'Rao Distribution House',
    gstNumber: '29AAECR4567L1ZP',
    customerType: 'DISTRIBUTOR',
    address: '48 Industrial Suburb, Yeshwanthpur, Bengaluru, Karnataka 560022',
    status: 'LEAD',
    followUpInDays: -1,
    notes: 'Referred by Nair Electricals. Follow-up is overdue.',
  },
  {
    name: 'Mahesh Gupta',
    mobile: '9123456780',
    email: 'mahesh@guptatrading.in',
    businessName: 'Gupta Trading Co',
    gstNumber: '09AAFCG3421M1ZK',
    customerType: 'WHOLESALE',
    address: '5 Hazratganj, Lucknow, Uttar Pradesh 226001',
    status: 'ACTIVE',
    followUpInDays: null,
    notes: null,
  },
];

interface SeedProduct {
  name: string;
  sku: string;
  category: string;
  unitPrice: string;
  openingStock: number;
  minStockAlert: number;
  location: string;
}

/**
 * The stock figures are chosen so the UI has something real to show from the
 * first login: three products are at or below their alert threshold (low-stock
 * indicator), and one is at zero so the insufficient-stock error path can be
 * demonstrated without any setup.
 */
const SEED_PRODUCTS: SeedProduct[] = [
  {
    name: 'Copper Wire 2.5mm (100m)',
    sku: 'CW-25-100M',
    category: 'Electrical',
    unitPrice: '1250.00',
    openingStock: 120,
    minStockAlert: 20,
    location: 'Main Warehouse / Rack A-12',
  },
  {
    name: 'PVC Conduit Pipe 20mm',
    sku: 'PVC-20',
    category: 'Electrical',
    unitPrice: '440.00',
    openingStock: 300,
    minStockAlert: 50,
    location: 'Main Warehouse / Rack A-14',
  },
  {
    name: 'LED Panel Light 18W',
    sku: 'LED-PL-18',
    category: 'Lighting',
    unitPrice: '690.00',
    openingStock: 15, // below threshold - low stock
    minStockAlert: 25,
    location: 'Main Warehouse / Rack B-02',
  },
  {
    name: 'Modular Switch 6A',
    sku: 'MS-6A',
    category: 'Switchgear',
    unitPrice: '95.00',
    openingStock: 800,
    minStockAlert: 100,
    location: 'Main Warehouse / Rack B-07',
  },
  {
    name: 'MCB 32A Single Pole',
    sku: 'MCB-32-SP',
    category: 'Switchgear',
    unitPrice: '310.00',
    openingStock: 8, // below threshold - low stock
    minStockAlert: 30,
    location: 'Main Warehouse / Rack B-09',
  },
  {
    name: 'Aluminium Ladder 8ft',
    sku: 'ALU-LDR-8',
    category: 'Tools',
    unitPrice: '4850.00',
    openingStock: 0, // out of stock - demonstrates the insufficient-stock error
    minStockAlert: 5,
    location: 'Godown 2 / Bay 1',
  },
  {
    name: 'Insulation Tape (Pack of 10)',
    sku: 'INS-TAPE-10',
    category: 'Consumables',
    unitPrice: '180.00',
    openingStock: 450,
    minStockAlert: 60,
    location: 'Main Warehouse / Rack C-01',
  },
  {
    name: 'Cable Gland 25mm',
    sku: 'CG-25',
    category: 'Consumables',
    unitPrice: '42.00',
    openingStock: 1200,
    minStockAlert: 200,
    location: 'Main Warehouse / Rack C-04',
  },
  {
    name: 'Distribution Box 8-Way',
    sku: 'DB-8W',
    category: 'Switchgear',
    unitPrice: '2150.00',
    openingStock: 40,
    minStockAlert: 10,
    location: 'Godown 2 / Bay 3',
  },
  {
    name: 'Ceiling Fan 1200mm',
    sku: 'CF-1200',
    category: 'Appliances',
    unitPrice: '1890.00',
    openingStock: 26, // exactly at threshold - low stock is `<=`, so this counts
    minStockAlert: 26,
    location: 'Godown 2 / Bay 5',
  },
];

interface SeedChallan {
  /** Customers are matched on mobile, which is their natural key here. */
  customerMobile: string;
  status: 'DRAFT' | 'CONFIRMED' | 'CANCELLED';
  notes: string | null;
  items: Array<{ sku: string; quantity: number }>;
}

/**
 * One challan in each state, so the module and the dashboard have something to
 * show before anyone has typed anything.
 *
 * The confirmed one draws only on products held well above their alert level.
 * That is deliberate: the low-stock and out-of-stock figures chosen above are
 * demo fixtures in their own right, and a seeded dispatch that quietly pushed a
 * fourth product under its threshold would break them.
 */
const SEED_CHALLANS: SeedChallan[] = [
  {
    customerMobile: '9876543210', // Sharma Traders
    status: 'CONFIRMED',
    notes: 'Delivered to the Ring Road godown. Gate pass signed by the storekeeper.',
    items: [
      { sku: 'CW-25-100M', quantity: 10 },
      { sku: 'MS-6A', quantity: 50 },
      { sku: 'CG-25', quantity: 200 },
    ],
  },
  {
    customerMobile: '9812345678', // Nair Electricals
    status: 'DRAFT',
    notes: 'Awaiting confirmation of the delivery window before dispatch.',
    items: [
      { sku: 'LED-PL-18', quantity: 5 },
      { sku: 'DB-8W', quantity: 4 },
    ],
  },
  {
    customerMobile: '9701234567', // Deshmukh Enterprises
    status: 'CANCELLED',
    notes: 'Cancelled - customer revised the order before dispatch. No stock was affected.',
    items: [{ sku: 'PVC-20', quantity: 25 }],
  },
];

// -----------------------------------------------------------------------------
// Seeding steps
// -----------------------------------------------------------------------------

async function seedUsers(client: PoolClient): Promise<Map<Role, number>> {
  const idsByRole = new Map<Role, number>();
  let created = 0;

  for (const user of SEED_USERS) {
    const existing = await client.query<{ id: string; role: Role }>(
      'SELECT id, role FROM users WHERE lower(email) = lower($1)',
      [user.email],
    );

    const found = existing.rows[0];
    if (found) {
      idsByRole.set(found.role, Number(found.id));
      continue;
    }

    const passwordHash = await hashPassword(user.password);
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO users (name, email, password_hash, role)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [user.name, user.email, passwordHash, user.role],
    );

    const row = inserted.rows[0];
    if (!row) throw new Error(`Failed to insert seed user ${user.email}`);

    idsByRole.set(user.role, Number(row.id));
    created += 1;
  }

  logger.info('Users seeded', { created, total: SEED_USERS.length });
  return idsByRole;
}

async function seedCustomers(client: PoolClient, createdBy: number): Promise<void> {
  let created = 0;

  for (const customer of SEED_CUSTOMERS) {
    const result = await client.query<{ id: string }>(
      `INSERT INTO customers
         (name, mobile, email, business_name, gst_number, customer_type,
          address, status, follow_up_date, notes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       -- The WHERE clause is required, not optional: migration 002 replaced the
       -- plain UNIQUE(mobile) constraint with a PARTIAL unique index over live
       -- rows. ON CONFLICT can only infer a partial index if the predicate is
       -- restated here; without it PostgreSQL raises "there is no unique or
       -- exclusion constraint matching the ON CONFLICT specification".
       ON CONFLICT (mobile) WHERE deleted_at IS NULL DO NOTHING
       RETURNING id`,
      [
        customer.name,
        customer.mobile,
        customer.email,
        customer.businessName,
        customer.gstNumber,
        customer.customerType,
        customer.address,
        customer.status,
        customer.followUpInDays === null ? null : dateFromToday(customer.followUpInDays),
        customer.notes,
        createdBy,
      ],
    );

    if (result.rowCount && result.rowCount > 0) created += 1;
  }

  logger.info('Customers seeded', { created, total: SEED_CUSTOMERS.length });
}

async function seedProducts(client: PoolClient, createdBy: number): Promise<void> {
  let created = 0;
  let openingMovements = 0;

  for (const product of SEED_PRODUCTS) {
    // current_stock is deliberately left at its 0 default here. Stock arrives
    // below, through a movement, exactly as it would in the running system.
    const result = await client.query<{ id: string }>(
      `INSERT INTO products
         (name, sku, category, unit_price, min_stock_alert, location, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (sku) DO NOTHING
       RETURNING id`,
      [
        product.name,
        product.sku,
        product.category,
        product.unitPrice,
        product.minStockAlert,
        product.location,
        createdBy,
      ],
    );

    const row = result.rows[0];
    // No row returned means the SKU already existed: skip it entirely, so a
    // re-run never adds a second opening-stock movement.
    if (!row) continue;

    created += 1;
    if (product.openingStock <= 0) continue;

    const productId = Number(row.id);

    await client.query(
      `INSERT INTO stock_movements
         (product_id, movement_type, quantity, reason, balance_after, reference_type, created_by)
       VALUES ($1, 'IN', $2, 'Opening stock', $2, 'MANUAL', $3)`,
      [productId, product.openingStock, createdBy],
    );

    await client.query('UPDATE products SET current_stock = $1 WHERE id = $2', [
      product.openingStock,
      productId,
    ]);

    openingMovements += 1;
  }

  logger.info('Products seeded', { created, openingMovements, total: SEED_PRODUCTS.length });
}

/**
 * Seeds one challan per lifecycle state.
 *
 * Guarded on the table being empty rather than on each challan individually.
 * Challan numbers come from a sequence, so there is no natural key to conflict
 * on — and more importantly, confirming deducts stock: a per-row guard that
 * misfired would deduct a second time and put the ledger permanently at odds
 * with `current_stock`, which is the one invariant this whole project exists to
 * protect. All-or-nothing is the only safe shape.
 *
 * The line items and totals are written through the same repository functions
 * the API uses, so the snapshot columns and the derived totals are produced by
 * the real code rather than a copy of it that could drift.
 */
async function seedChallans(
  client: PoolClient,
  salesUserId: number,
  warehouseUserId: number,
): Promise<void> {
  const existing = await client.query<{ count: string }>(
    'SELECT count(*)::text AS count FROM sales_challans',
  );

  if (Number(existing.rows[0]?.count ?? 0) > 0) {
    logger.info('Challans seeded', { created: 0, reason: 'challans already exist' });
    return;
  }

  const products = await client.query<{
    id: string;
    sku: string;
    name: string;
    unit_price: string;
    current_stock: number;
  }>('SELECT id, sku, name, unit_price, current_stock FROM products');
  const bySku = new Map(products.rows.map((row) => [row.sku, row]));

  const customers = await client.query<{ id: string; mobile: string }>(
    'SELECT id, mobile FROM customers WHERE deleted_at IS NULL',
  );
  const byMobile = new Map(customers.rows.map((row) => [row.mobile, Number(row.id)]));

  let created = 0;
  let outMovements = 0;

  for (const seed of SEED_CHALLANS) {
    const customerId = byMobile.get(seed.customerMobile);
    if (customerId === undefined) continue;

    const lines = seed.items
      .map((item) => ({ item, product: bySku.get(item.sku) }))
      .filter((line): line is { item: (typeof seed.items)[number]; product: NonNullable<typeof line.product> } =>
        line.product !== undefined,
      );

    if (lines.length !== seed.items.length) continue;

    const challanNumber = await challanRepository.nextChallanNumber(client);
    const challanId = await challanRepository.insertChallan(
      client,
      challanNumber,
      customerId,
      seed.notes,
      salesUserId,
    );

    await challanRepository.replaceItems(
      client,
      challanId,
      lines.map(({ item, product }) => ({
        productId: Number(product.id),
        productName: product.name,
        productSku: product.sku,
        unitPrice: product.unit_price,
        quantity: item.quantity,
      })),
    );

    await challanRepository.recalculateTotals(client, challanId);

    // Backdated so the list is not three rows all stamped the same second.
    await client.query(
      "UPDATE sales_challans SET created_at = now() - interval '6 days' WHERE id = $1",
      [challanId],
    );

    if (seed.status === 'CONFIRMED') {
      for (const { item, product } of lines) {
        const balanceAfter = product.current_stock - item.quantity;

        await client.query('UPDATE products SET current_stock = $1 WHERE id = $2', [
          balanceAfter,
          product.id,
        ]);

        await client.query(
          `INSERT INTO stock_movements
             (product_id, movement_type, quantity, reason, balance_after,
              reference_type, reference_id, created_by)
           VALUES ($1, 'OUT', $2, $3, $4, 'SALES_CHALLAN', $5, $6)`,
          [
            product.id,
            item.quantity,
            `Sales challan ${challanNumber}`,
            balanceAfter,
            challanId,
            warehouseUserId,
          ],
        );

        outMovements += 1;
      }

      // Confirmed a couple of hours ago rather than days: the dashboard counts
      // dispatches by confirmation date within the current month, and a stamp
      // near "now" keeps that counter non-zero whatever day the seed runs.
      await client.query(
        `UPDATE sales_challans
            SET status = 'CONFIRMED', confirmed_by = $2, confirmed_at = now() - interval '2 hours'
          WHERE id = $1`,
        [challanId, warehouseUserId],
      );
    }

    if (seed.status === 'CANCELLED') {
      await client.query(
        `UPDATE sales_challans
            SET status = 'CANCELLED', cancelled_by = $2, cancelled_at = now() - interval '5 days'
          WHERE id = $1`,
        [challanId, salesUserId],
      );
    }

    created += 1;
  }

  logger.info('Challans seeded', { created, outMovements, total: SEED_CHALLANS.length });
}

// -----------------------------------------------------------------------------
// Entry point
// -----------------------------------------------------------------------------

async function main(): Promise<void> {
  // The seed passwords have documented development defaults. Running this
  // against a production database without meaning to would create accounts with
  // guessable credentials, so it takes a deliberate opt-in.
  if (env.isProduction && !env.ALLOW_PRODUCTION_SEED) {
    logger.error(
      'Refusing to seed: NODE_ENV=production. Set ALLOW_PRODUCTION_SEED=true and ' +
        'strong SEED_*_PASSWORD values if you really intend to seed this database.',
    );
    await pool.end().catch(() => undefined);
    process.exit(1);
  }

  try {
    await withTransaction(async (client) => {
      const userIds = await seedUsers(client);

      const adminId = userIds.get('ADMIN');
      const warehouseId = userIds.get('WAREHOUSE');
      const salesId = userIds.get('SALES');
      if (adminId === undefined || warehouseId === undefined || salesId === undefined) {
        throw new Error('Seed users are missing - cannot attribute seeded records');
      }

      await seedCustomers(client, adminId);
      await seedProducts(client, warehouseId);
      // Last: challans reference customers and products, and confirming one
      // deducts the stock those products were just given.
      await seedChallans(client, salesId, warehouseId);
    });

    logger.info('Seed complete');
    logger.info(
      'Login with the SEED_*_PASSWORD values from your .env ' +
        '(defaults are documented in the README).',
      { accounts: SEED_USERS.map((user) => `${user.role}: ${user.email}`) },
    );

    await pool.end();
    process.exit(0);
  } catch (error) {
    logger.error('Seed failed - the database was left unchanged', {
      error: error instanceof Error ? error.message : String(error),
    });
    await pool.end().catch(() => undefined);
    process.exit(1);
  }
}

// Only when run as a script — see the identical guard in migrate.ts.
if (require.main === module) {
  void main();
}
