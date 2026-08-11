/**
 * Builds the Postman collection and environment from a single source of truth.
 *
 *     node postman/build-collection.mjs
 *
 * The collection is generated rather than hand-edited because a 2,700-line JSON
 * file maintained by hand drifts from the API within a phase or two: request
 * bodies get copy-pasted, one folder keeps an old field name, and nobody
 * notices until a reviewer runs it. Here every request is a few lines, the
 * shared pieces (status assertions, id capture, the error-envelope check) are
 * written once, and the whole thing is verified end to end with:
 *
 *     npx newman run postman/Mini-ERP-CRM.postman_collection.json \
 *       -e postman/Mini-ERP-CRM.postman_environment.json
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = dirname(fileURLToPath(import.meta.url));

/** Builds a Postman v2.1 request item. */
function req({ name, method = 'GET', path = [], query = [], body, desc, test, prerequest, auth, host = '{{baseUrl}}' }) {
  const rawQuery = query.filter((q) => !q.disabled).map((q) => `${q.key}=${q.value}`).join('&');
  const item = {
    name,
    request: {
      method,
      header: body ? [{ key: 'Content-Type', value: 'application/json' }] : [],
      url: {
        raw: `${host}${path.length ? `/${path.join('/')}` : '/'}${rawQuery ? `?${rawQuery}` : ''}`,
        host: [host],
        path,
        ...(query.length ? { query } : {}),
      },
      description: desc,
    },
    response: [],
  };

  if (body !== undefined) {
    item.request.body = {
      mode: 'raw',
      raw: JSON.stringify(body, null, 2),
      options: { raw: { language: 'json' } },
    };
  }
  if (auth === false) item.request.auth = { type: 'noauth' };

  const events = [];
  if (prerequest) {
    events.push({ listen: 'prerequest', script: { type: 'text/javascript', exec: prerequest } });
  }
  if (test) events.push({ listen: 'test', script: { type: 'text/javascript', exec: test } });
  if (events.length) item.event = events;

  return item;
}

const status = (code) => [
  `pm.test("Status ${code}", function () {`,
  `    pm.response.to.have.status(${code});`,
  '});',
];

const saveId = (varName, code = 201) => [
  ...status(code),
  '',
  'const body = pm.response.json();',
  `pm.environment.set("${varName}", body.data.id);`,
  `console.log("${varName} =", body.data.id);`,
];

const errorShape = (code, errorCode) => [
  ...status(code),
  '',
  'pm.test("Error envelope", function () {',
  '    const body = pm.response.json();',
  '    pm.expect(body.success).to.eql(false);',
  `    pm.expect(body.error.code).to.eql("${errorCode}");`,
  '});',
];

// ---- unique-per-run values so the collection can be re-run without 409s ------
const uniquePrereq = [
  '// Keeps the collection re-runnable: a fresh mobile / SKU on every run, so the',
  '// second run does not fail on DUPLICATE_MOBILE / DUPLICATE_SKU.',
  'const stamp = String(Date.now()).slice(-8);',
  'pm.environment.set("runStamp", stamp);',
  'pm.environment.set("runMobile", "9" + stamp + "0");',
  'pm.environment.set("runSku", "DEMO-" + stamp);',
];

// =============================================================================
const folders = [];

folders.push({
  name: 'System',
  description: 'Public endpoints. Neither needs a token.',
  item: [
    req({
      name: 'Service banner',
      path: [],
      host: '{{rootUrl}}',
      auth: false,
      desc:
        'GET / — the only route OUTSIDE the /api prefix, so it uses {{rootUrl}} rather than ' +
        '{{baseUrl}}. Confirms a deploy is live at all.',
      test: status(200),
    }),
    req({
      name: 'Health check',
      path: ['health'],
      auth: false,
      desc:
        'Liveness plus database connectivity. Returns 200 with status "ok", or 503 with ' +
        '"degraded" when the database is unreachable — it reports the outage rather than ' +
        'failing with a 500.',
      test: [
        ...status(200),
        '',
        'pm.test("Database is up", function () {',
        '    pm.expect(pm.response.json().data.database.status).to.eql("up");',
        '});',
      ],
    }),
  ],
});

folders.push({
  name: 'Auth',
  description:
    'Run "Login (admin)" first — its test script writes {{token}} into the environment and ' +
    'collection-level auth applies it to every other request.',
  item: [
    req({
      name: 'Login (admin)',
      method: 'POST',
      path: ['auth', 'login'],
      auth: false,
      body: { email: 'admin@fundsroom.local', password: 'Admin@12345' },
      desc: 'Exchanges credentials for an 8-hour JWT and stores it as {{token}}.',
      test: [
        ...status(200),
        '',
        'const body = pm.response.json();',
        'pm.environment.set("token", body.data.token);',
        '',
        'pm.test("Returns a token and the user profile", function () {',
        '    pm.expect(body.data.token).to.be.a("string");',
        '    pm.expect(body.data.user.role).to.eql("ADMIN");',
        '});',
      ],
    }),
    req({
      name: 'Login (sales)',
      method: 'POST',
      path: ['auth', 'login'],
      auth: false,
      body: { email: 'sales@fundsroom.local', password: 'Sales@12345' },
      desc: 'Stores {{salesToken}} — used by the role-restriction examples in the Errors folder.',
      test: [
        ...status(200),
        '',
        'pm.environment.set("salesToken", pm.response.json().data.token);',
      ],
    }),
    req({
      name: 'Login (warehouse)',
      method: 'POST',
      path: ['auth', 'login'],
      auth: false,
      body: { email: 'warehouse@fundsroom.local', password: 'Warehouse@12345' },
      desc: 'Stores {{warehouseToken}} — used by the 403 examples in the Errors folder.',
      test: [
        ...status(200),
        '',
        'pm.environment.set("warehouseToken", pm.response.json().data.token);',
      ],
    }),
    req({
      name: 'Current user',
      path: ['auth', 'me'],
      desc: 'Rehydrates a session after a refresh: the client holds the token, not the profile.',
      test: status(200),
    }),
    req({
      name: 'List users (Admin only)',
      path: ['users'],
      desc: 'Who has access to the portal. Read-only and not paginated — the staff list is small.',
      test: status(200),
    }),
  ],
});

folders.push({
  name: 'Customers',
  item: [
    req({
      name: 'List customers',
      path: ['customers'],
      query: [
        { key: 'page', value: '1' },
        { key: 'limit', value: '20' },
        { key: 'search', value: 'sharma', disabled: true },
        { key: 'status', value: 'ACTIVE', disabled: true },
        { key: 'customerType', value: 'WHOLESALE', disabled: true },
        { key: 'followUpBefore', value: '2026-08-31', disabled: true },
        { key: 'sortBy', value: 'createdAt', disabled: true },
        { key: 'sortOrder', value: 'desc', disabled: true },
      ],
      desc:
        'search matches name, businessName, mobile and email. Disabled query params show every ' +
        'filter the endpoint accepts — tick them on in Postman to try them.',
      test: [
        ...status(200),
        '',
        'pm.test("Paginated envelope", function () {',
        '    const body = pm.response.json();',
        '    pm.expect(body.data).to.be.an("array");',
        '    pm.expect(body.pagination).to.have.property("totalPages");',
        '});',
      ],
    }),
    req({
      name: 'Create customer',
      method: 'POST',
      path: ['customers'],
      prerequest: uniquePrereq,
      body: {
        name: 'Priya Nair',
        mobile: '{{runMobile}}',
        email: 'priya{{runStamp}}@nairenterprises.in',
        businessName: 'Nair Enterprises',
        gstNumber: '29AABCN7654P1Z3',
        customerType: 'RETAIL',
        address: '22 Brigade Road, Bengaluru, Karnataka 560001',
        followUpDate: '2026-08-20',
        notes: 'Walk-in enquiry for LED panels.',
      },
      desc:
        'Saves {{customerId}}. The server normalises as it stores: the mobile loses its ' +
        'punctuation, the email is lower-cased, the GST number is upper-cased, and status ' +
        'defaults to LEAD.',
      test: saveId('customerId'),
    }),
    req({
      name: 'Get customer',
      path: ['customers', '{{customerId}}'],
      test: status(200),
    }),
    req({
      name: 'Update customer',
      method: 'PUT',
      path: ['customers', '{{customerId}}'],
      body: {
        name: 'Priya Nair',
        mobile: '{{runMobile}}',
        email: 'priya{{runStamp}}@nairenterprises.in',
        businessName: 'Nair Enterprises (Bengaluru)',
        gstNumber: '29AABCN7654P1Z3',
        customerType: 'WHOLESALE',
        address: '22 Brigade Road, Bengaluru, Karnataka 560001',
        status: 'ACTIVE',
        followUpDate: '2026-09-01',
        notes: 'Upgraded to wholesale terms.',
      },
      desc:
        'A full replacement — every required field must be present, and status is required here ' +
        '(no default). Keeping your own mobile number is fine; taking another customer\u2019s is 409.',
      test: status(200),
    }),
    req({
      name: 'List follow-ups',
      path: ['customers', '{{customerId}}', 'follow-ups'],
      query: [{ key: 'page', value: '1' }, { key: 'limit', value: '20' }],
      desc: 'Newest first. Accepts page and limit only.',
      test: status(200),
    }),
    req({
      name: 'Add follow-up',
      method: 'POST',
      path: ['customers', '{{customerId}}', 'follow-ups'],
      body: {
        note: 'Called about the 40-unit LED panel order. Will confirm on Monday.',
        nextFollowUpDate: '2026-08-17',
      },
      desc:
        'When nextFollowUpDate is present the customer\u2019s own followUpDate is moved to match, in ' +
        'the same transaction — so the CRM list and the note history cannot disagree.',
      test: [
        ...status(201),
        '',
        'pm.test("Note is stored with its next date", function () {',
        '    const d = pm.response.json().data;',
        '    pm.expect(d.nextFollowUpDate).to.eql("2026-08-17");',
        '});',
      ],
    }),
    req({
      name: "Customer's challans",
      path: ['customers', '{{customerId}}', 'challans'],
      desc: 'Challan summaries for this customer (no line items). page and limit only.',
      test: status(200),
    }),
    req({
      name: 'Create a throwaway customer (to delete)',
      method: 'POST',
      path: ['customers'],
      prerequest: [
        '// A separate customer for the delete demo, so {{customerId}} survives for the',
        '// Challans folder — a soft-deleted customer cannot be put on a challan.',
        'const stamp = String(Date.now()).slice(-8);',
        'pm.environment.set("deleteMobile", "8" + stamp + "0");',
        'pm.environment.set("deleteStamp", stamp);',
      ],
      body: {
        name: 'Temporary Record',
        mobile: '{{deleteMobile}}',
        email: 'temp{{deleteStamp}}@example.in',
        businessName: 'Temporary Record Ltd',
        customerType: 'RETAIL',
        address: '9 Scratch Lane, Surat, Gujarat 395003',
      },
      test: saveId('deleteCustomerId'),
    }),
    req({
      name: 'Delete customer (soft, Admin only)',
      method: 'DELETE',
      path: ['customers', '{{deleteCustomerId}}'],
      desc:
        'Stamps deleted_at and returns 204 with no body. The row disappears from every read path; ' +
        'challans already raised for the customer are untouched, because the documents remain ' +
        'valid history.',
      test: status(204),
    }),
    req({
      name: 'Deleted customer is gone',
      path: ['customers', '{{deleteCustomerId}}'],
      desc: 'A soft-deleted customer is a 404, not an empty record — it no longer exists to the API.',
      test: errorShape(404, 'NOT_FOUND'),
    }),
  ],
});

folders.push({
  name: 'Products',
  item: [
    req({
      name: 'List products',
      path: ['products'],
      query: [
        { key: 'page', value: '1' },
        { key: 'limit', value: '20' },
        { key: 'search', value: 'copper', disabled: true },
        { key: 'category', value: 'Electrical', disabled: true },
        { key: 'lowStock', value: 'true', disabled: true },
        { key: 'isActive', value: 'all', disabled: true },
        { key: 'sortBy', value: 'currentStock', disabled: true },
        { key: 'sortOrder', value: 'asc', disabled: true },
      ],
      desc:
        'isActive defaults to "true": deactivated products are hidden unless asked for, because ' +
        'they cannot be sold. isLowStock is computed in SQL (currentStock <= minStockAlert), ' +
        'never stored.',
      test: status(200),
    }),
    req({
      name: 'List categories',
      path: ['products', 'categories'],
      desc:
        'Distinct categories in use, as a flat string array. Feeds the filter dropdown without ' +
        'fetching every product.',
      test: status(200),
    }),
    req({
      name: 'Create product (with opening stock)',
      method: 'POST',
      path: ['products'],
      prerequest: uniquePrereq,
      body: {
        name: 'Halogen Floodlight 150W',
        sku: '{{runSku}}',
        category: 'Lighting',
        unitPrice: '890.50',
        minStockAlert: 10,
        location: 'Godown 2 / Bay 1',
        openingStock: 40,
      },
      desc:
        'Saves {{productId}}. A non-zero openingStock writes an IN movement with reason ' +
        '"Opening stock" in the same transaction — stock never appears from nowhere. The SKU is ' +
        'stored upper-cased.',
      test: [
        ...saveId('productId'),
        '',
        'pm.test("Opening stock became current stock", function () {',
        '    pm.expect(pm.response.json().data.currentStock).to.eql(40);',
        '});',
      ],
    }),
    req({
      name: 'Get product',
      path: ['products', '{{productId}}'],
      test: status(200),
    }),
    req({
      name: 'Update product',
      method: 'PUT',
      path: ['products', '{{productId}}'],
      body: {
        name: 'Halogen Floodlight 150W',
        sku: '{{runSku}}',
        category: 'Lighting',
        unitPrice: '920.00',
        minStockAlert: 12,
        location: 'Godown 2 / Bay 3',
      },
      desc:
        'Full replacement, stock excluded. Sending currentStock here is a deliberate 422 — see ' +
        'the Errors folder.',
      test: status(200),
    }),
    req({
      name: 'Deactivate product',
      method: 'PATCH',
      path: ['products', '{{productId}}', 'status'],
      body: { isActive: false },
      desc:
        'The alternative to deleting a product that has ledger rows behind it. A deactivated ' +
        'product is hidden from the default list and cannot be put on a challan; its history and ' +
        'stock figure are untouched.',
      test: status(200),
    }),
    req({
      name: 'Reactivate product',
      method: 'PATCH',
      path: ['products', '{{productId}}', 'status'],
      body: { isActive: true },
      test: status(200),
    }),
    req({
      name: 'Product stock movements',
      path: ['products', '{{productId}}', 'movements'],
      desc:
        'This product\u2019s ledger, newest first. Accepts the stock-movement filters; the path id ' +
        'always wins over a productId query parameter.',
      test: status(200),
    }),
  ],
});

folders.push({
  name: 'Stock movements',
  description:
    'The ledger is append-only: no update, no delete. A mistake is corrected by recording the ' +
    'opposite movement, which leaves both entries visible.',
  item: [
    req({
      name: 'List movements',
      path: ['stock-movements'],
      query: [
        { key: 'page', value: '1' },
        { key: 'limit', value: '20' },
        { key: 'productId', value: '{{productId}}', disabled: true },
        { key: 'movementType', value: 'OUT', disabled: true },
        { key: 'referenceType', value: 'SALES_CHALLAN', disabled: true },
        { key: 'createdBy', value: '1', disabled: true },
        { key: 'dateFrom', value: '2026-08-01', disabled: true },
        { key: 'dateTo', value: '2026-08-31', disabled: true },
      ],
      desc:
        'referenceType SALES_CHALLAN with a referenceId means the row was written by confirming ' +
        'that challan — every automatic deduction is traceable to the document that caused it.',
      test: status(200),
    }),
    req({
      name: 'Record manual movement (OUT)',
      method: 'POST',
      path: ['stock-movements'],
      body: {
        productId: '{{productId}}',
        movementType: 'OUT',
        quantity: 3,
        reason: 'Damaged during handling',
      },
      desc:
        'Runs in a transaction: lock the product row FOR UPDATE, verify stock for an OUT, update ' +
        'the stock, insert the movement with balanceAfter. reason is mandatory — every stock ' +
        'change must still be explainable months later.',
      test: [
        ...status(201),
        '',
        'pm.test("Balance was stamped on the row", function () {',
        '    const d = pm.response.json().data;',
        '    pm.expect(d.balanceAfter).to.eql(37);',
        '    pm.expect(d.referenceType).to.eql("MANUAL");',
        '});',
      ],
    }),
  ],
});

folders.push({
  name: 'Challans',
  description:
    'A DRAFT never touches stock. Confirming deducts every line atomically and writes one OUT ' +
    'movement per line. Line items carry a snapshot of the product, so a later rename or reprice ' +
    'cannot rewrite a dispatched document.',
  item: [
    req({
      name: 'List challans',
      path: ['challans'],
      query: [
        { key: 'page', value: '1' },
        { key: 'limit', value: '20' },
        { key: 'search', value: 'CH-2026', disabled: true },
        { key: 'status', value: 'CONFIRMED', disabled: true },
        { key: 'customerId', value: '{{customerId}}', disabled: true },
        { key: 'createdBy', value: '1', disabled: true },
        { key: 'dateFrom', value: '2026-08-01', disabled: true },
        { key: 'dateTo', value: '2026-08-31', disabled: true },
        { key: 'sortBy', value: 'createdAt', disabled: true },
      ],
      desc: 'Returns the summary shape: header fields plus itemCount, without line items.',
      test: status(200),
    }),
    req({
      name: 'Create challan (draft)',
      method: 'POST',
      path: ['challans'],
      body: {
        customerId: '{{customerId}}',
        items: [{ productId: '{{productId}}', quantity: 4 }],
        notes: 'Deliver to the Bengaluru godown.',
        confirmImmediately: false,
      },
      desc:
        'Saves {{challanId}}. The client never sends a price: name, SKU and unit price are read ' +
        'from the products table server-side, so a caller cannot decide what something sold for.',
      test: [
        ...saveId('challanId'),
        '',
        'pm.test("Created as a DRAFT with a server-issued number", function () {',
        '    const d = pm.response.json().data;',
        '    pm.expect(d.status).to.eql("DRAFT");',
        '    pm.expect(d.challanNumber).to.match(/^CH-\\d{4}-\\d{6}$/);',
        '});',
      ],
    }),
    req({
      name: 'Get challan',
      path: ['challans', '{{challanId}}'],
      desc:
        'Detail shape: header plus items. productName / productSku / unitPrice come from the ' +
        'snapshot columns; availableStock is the live figure joined in for the UI.',
      test: status(200),
    }),
    req({
      name: 'Update challan (draft only)',
      method: 'PUT',
      path: ['challans', '{{challanId}}'],
      body: {
        customerId: '{{customerId}}',
        items: [{ productId: '{{productId}}', quantity: 6 }],
        notes: 'Revised: floodlights only.',
      },
      desc: 'Items are replaced wholesale, not merged. Legal only while the challan is a DRAFT.',
      test: status(200),
    }),
    req({
      name: 'Confirm challan',
      method: 'POST',
      path: ['challans', '{{challanId}}', 'confirm'],
      desc:
        'The critical endpoint. No body. One transaction: lock the challan, lock every product ' +
        'ordered by id (so concurrent confirmations cannot deadlock), verify EVERY line before ' +
        'changing anything, then deduct, write one OUT movement per line, refresh the snapshots ' +
        'and set CONFIRMED. Any shortfall rolls back the lot.',
      test: [
        ...status(200),
        '',
        'pm.test("Confirmed, with a confirmedBy and confirmedAt", function () {',
        '    const d = pm.response.json().data;',
        '    pm.expect(d.status).to.eql("CONFIRMED");',
        '    pm.expect(d.confirmedBy).to.not.eql(null);',
        '    pm.expect(d.confirmedAt).to.not.eql(null);',
        '});',
      ],
    }),
    req({
      name: 'Create second draft (to cancel)',
      method: 'POST',
      path: ['challans'],
      body: {
        customerId: '{{customerId}}',
        items: [{ productId: '{{productId}}', quantity: 1 }],
        notes: 'To be cancelled.',
      },
      test: saveId('draftChallanId'),
    }),
    req({
      name: 'Cancel challan',
      method: 'POST',
      path: ['challans', '{{draftChallanId}}', 'cancel'],
      body: { reason: 'Customer withdrew the order' },
      desc:
        'Legal only from DRAFT. reason is optional and is appended to the notes so the document ' +
        'explains itself. No stock is touched — a draft never reserved any.',
      test: [
        ...status(200),
        '',
        'pm.test("Cancelled", function () {',
        '    pm.expect(pm.response.json().data.status).to.eql("CANCELLED");',
        '});',
      ],
    }),
    req({
      name: 'Create + confirm in one call',
      method: 'POST',
      path: ['challans'],
      body: {
        customerId: '{{customerId}}',
        items: [{ productId: '{{productId}}', quantity: 2 }],
        notes: 'Save and confirm in one call.',
        confirmImmediately: true,
      },
      desc:
        'The "Save & Confirm" button. Creation and stock deduction share one transaction, so an ' +
        'insufficient-stock failure leaves no draft behind — nothing at all is written.',
      test: [
        ...status(201),
        '',
        'pm.test("Created already CONFIRMED", function () {',
        '    pm.expect(pm.response.json().data.status).to.eql("CONFIRMED");',
        '});',
      ],
    }),
  ],
});

folders.push({
  name: 'Dashboard',
  item: [
    req({
      name: 'Summary',
      path: ['dashboard', 'summary'],
      desc:
        'Every number is a live aggregate query. outOfStock is a SUBSET of lowStock, not a ' +
        'separate population; confirmedThisMonth / valueThisMonth are measured on confirmedAt. ' +
        'Each list carries at most 5 rows.',
      test: [
        ...status(200),
        '',
        'pm.test("All six panels are present", function () {',
        '    const d = pm.response.json().data;',
        '    ["customers","products","challans","lowStockProducts","recentChallans","recentMovements"]',
        '        .forEach((k) => pm.expect(d).to.have.property(k));',
        '});',
      ],
    }),
  ],
});

// ---- Workflow ---------------------------------------------------------------
folders.push({
  name: 'Workflow (end-to-end)',
  description:
    'The demo path, runnable top to bottom with Run collection: create a customer, create a ' +
    'product with opening stock, raise a challan, confirm it, then prove the stock moved and the ' +
    'ledger recorded why. Each step saves the id it created, so nothing needs editing by hand.',
  item: [
    req({
      name: '1. Login',
      method: 'POST',
      path: ['auth', 'login'],
      auth: false,
      body: { email: 'admin@fundsroom.local', password: 'Admin@12345' },
      test: [...status(200), '', 'pm.environment.set("token", pm.response.json().data.token);'],
    }),
    req({
      name: '2. Create customer',
      method: 'POST',
      path: ['customers'],
      prerequest: uniquePrereq,
      body: {
        name: 'Workflow Demo Buyer',
        mobile: '{{runMobile}}',
        email: 'buyer{{runStamp}}@example.in',
        businessName: 'Workflow Demo Traders',
        customerType: 'WHOLESALE',
        address: '1 Demo Road, Surat, Gujarat 395003',
        status: 'ACTIVE',
      },
      test: saveId('wfCustomerId'),
    }),
    req({
      name: '3. Create product with 50 opening stock',
      method: 'POST',
      path: ['products'],
      body: {
        name: 'Workflow Demo Cable',
        sku: 'WF-{{runStamp}}',
        category: 'Electrical',
        unitPrice: '100.00',
        minStockAlert: 5,
        location: 'Demo Rack',
        openingStock: 50,
      },
      test: [
        ...saveId('wfProductId'),
        '',
        'pm.test("Opening stock is 50", function () {',
        '    pm.expect(pm.response.json().data.currentStock).to.eql(50);',
        '});',
      ],
    }),
    req({
      name: '4. Raise a draft challan for 12 units',
      method: 'POST',
      path: ['challans'],
      body: {
        customerId: '{{wfCustomerId}}',
        items: [{ productId: '{{wfProductId}}', quantity: 12 }],
        notes: 'End-to-end workflow demo.',
      },
      test: [
        ...saveId('wfChallanId'),
        '',
        'pm.test("Draft, and stock has NOT moved yet", function () {',
        '    const d = pm.response.json().data;',
        '    pm.expect(d.status).to.eql("DRAFT");',
        '    pm.expect(d.items[0].availableStock).to.eql(50);',
        '});',
      ],
    }),
    req({
      name: '5. Confirm it',
      method: 'POST',
      path: ['challans', '{{wfChallanId}}', 'confirm'],
      test: [
        ...status(200),
        '',
        'pm.test("Confirmed, total is 12 x 100.00", function () {',
        '    const d = pm.response.json().data;',
        '    pm.expect(d.status).to.eql("CONFIRMED");',
        '    pm.expect(d.totalAmount).to.eql("1200.00");',
        '});',
      ],
    }),
    req({
      name: '6. Product now shows 38 in stock',
      path: ['products', '{{wfProductId}}'],
      test: [
        ...status(200),
        '',
        'pm.test("50 - 12 = 38", function () {',
        '    pm.expect(pm.response.json().data.currentStock).to.eql(38);',
        '});',
      ],
    }),
    req({
      name: '7. Ledger explains the deduction',
      path: ['products', '{{wfProductId}}', 'movements'],
      test: [
        ...status(200),
        '',
        'pm.test("An OUT of 12 references the challan", function () {',
        '    const out = pm.response.json().data.find((m) => m.movementType === "OUT");',
        '    pm.expect(out.quantity).to.eql(12);',
        '    pm.expect(out.balanceAfter).to.eql(38);',
        '    pm.expect(out.referenceType).to.eql("SALES_CHALLAN");',
        '    pm.expect(Number(out.referenceId)).to.eql(Number(pm.environment.get("wfChallanId")));',
        '});',
      ],
    }),
    req({
      name: '8. Confirming again is rejected',
      method: 'POST',
      path: ['challans', '{{wfChallanId}}', 'confirm'],
      desc: 'Confirmation is not idempotent, and says so rather than silently double-deducting.',
      test: errorShape(409, 'INVALID_STATE'),
    }),
  ],
});

// ---- Errors -----------------------------------------------------------------
folders.push({
  name: 'Errors (these fail on purpose)',
  description:
    'The documented 4xx contract, demonstrable rather than merely described. Every request here ' +
    'is expected to fail — the tests assert the failure.',
  item: [
    req({
      name: '401 — no token',
      path: ['customers'],
      auth: false,
      test: errorShape(401, 'UNAUTHENTICATED'),
    }),
    req({
      name: '401 — wrong password',
      method: 'POST',
      path: ['auth', 'login'],
      auth: false,
      body: { email: 'admin@fundsroom.local', password: 'wrong-password' },
      desc:
        'Unknown email, wrong password and a deactivated account all return exactly this, so the ' +
        'endpoint cannot be used to discover which accounts exist.',
      test: errorShape(401, 'INVALID_CREDENTIALS'),
    }),
    req({
      name: '403 — Warehouse cannot create a customer',
      method: 'POST',
      path: ['customers'],
      body: {
        name: 'Blocked Co',
        mobile: '9000000001',
        email: 'blocked@example.com',
        businessName: 'Blocked Co',
        customerType: 'RETAIL',
        address: '1 Test Street, Surat 395003',
      },
      desc: 'Uses {{warehouseToken}} — run "Auth → Login (warehouse)" first.',
      // noauth so the collection-level bearer helper does not overwrite the
      // warehouse token this script sets.
      auth: false,
      prerequest: [
        'pm.request.headers.upsert({',
        '    key: "Authorization",',
        '    value: "Bearer " + pm.environment.get("warehouseToken")',
        '});',
      ],
      test: errorShape(403, 'FORBIDDEN'),
    }),
    req({
      name: '400 — non-numeric id',
      path: ['customers', 'abc'],
      desc:
        '/customers/abc is not a resource address at all, so it is a 400 — not the 422 a bad ' +
        'body or query would get.',
      test: errorShape(400, 'BAD_REQUEST'),
    }),
    req({
      name: '404 — unknown customer',
      path: ['customers', '999999'],
      test: errorShape(404, 'NOT_FOUND'),
    }),
    req({
      name: '422 — validation, every problem at once',
      method: 'POST',
      path: ['auth', 'login'],
      auth: false,
      body: { email: '', password: '' },
      desc: 'Body, params and query are validated in one pass, so nothing is fixed one round trip at a time.',
      test: [
        ...errorShape(422, 'VALIDATION_ERROR'),
        '',
        'pm.test("Reports both fields", function () {',
        '    const fields = pm.response.json().error.details.map((d) => d.field);',
        '    pm.expect(fields).to.include("body.email");',
        '    pm.expect(fields).to.include("body.password");',
        '});',
      ],
    }),
    req({
      name: '422 — limit above 100 is rejected, not clamped',
      path: ['customers'],
      query: [{ key: 'limit', value: '500' }],
      desc: 'A client that asks for 500 rows should learn that it will not get them.',
      test: errorShape(422, 'VALIDATION_ERROR'),
    }),
    req({
      name: '422 — currentStock cannot be edited directly',
      method: 'PUT',
      path: ['products', '{{productId}}'],
      body: {
        name: 'Halogen Floodlight 150W',
        sku: '{{runSku}}',
        category: 'Lighting',
        unitPrice: '920.00',
        minStockAlert: 12,
        location: 'Godown 2 / Bay 3',
        currentStock: 500,
      },
      desc:
        'Unknown fields are normally stripped, which would make this look like it worked. The ' +
        'field is declared purely so it can be rejected with the rule attached.',
      test: [
        ...errorShape(422, 'VALIDATION_ERROR'),
        '',
        'pm.test("Explains the rule", function () {',
        '    const d = pm.response.json().error.details[0];',
        '    pm.expect(d.field).to.eql("body.currentStock");',
        '    pm.expect(d.message).to.include("Record a stock movement instead");',
        '});',
      ],
    }),
    req({
      name: '422 — the same product twice on one challan',
      method: 'POST',
      path: ['challans'],
      body: {
        customerId: '{{customerId}}',
        items: [
          { productId: '{{productId}}', quantity: 2 },
          { productId: '{{productId}}', quantity: 3 },
        ],
      },
      desc: 'Silently summing the lines would hide a data-entry mistake the user should see.',
      test: errorShape(422, 'VALIDATION_ERROR'),
    }),
    req({
      name: '409 — duplicate SKU',
      method: 'POST',
      path: ['products'],
      body: {
        name: 'Duplicate Wire',
        sku: 'CW-25-100M',
        category: 'Electrical',
        unitPrice: '10.00',
        minStockAlert: 1,
        location: 'Rack Z',
      },
      desc: 'Assumes the seeded catalogue. SKUs are compared upper-cased.',
      test: errorShape(409, 'DUPLICATE_SKU'),
    }),
    req({
      name: '409 — insufficient stock on a manual OUT',
      method: 'POST',
      path: ['stock-movements'],
      body: {
        productId: '{{productId}}',
        movementType: 'OUT',
        quantity: 999999,
        reason: 'Documentation example',
      },
      desc:
        'The transaction rolls back: no stock moves and no ledger row is written. The message ' +
        'names the product and both numbers.',
      test: errorShape(409, 'INSUFFICIENT_STOCK'),
    }),
    req({
      name: '409 — cancelling a confirmed challan',
      method: 'POST',
      path: ['challans', '{{challanId}}', 'cancel'],
      body: { reason: 'Changed my mind' },
      desc:
        'The goods have already left. Silently adding stock back would let anyone inflate ' +
        'inventory by confirming and cancelling in a loop — a stock return is a separate flow.',
      test: errorShape(409, 'INVALID_STATE'),
    }),
  ],
});

// =============================================================================
const collection = {
  info: {
    _postman_id: 'b7c1f0e2-5a41-4a8e-9d3f-mini-erp-crm-01',
    name: 'Mini ERP + CRM Operations Portal',
    description:
      'Every endpoint of the Mini ERP + CRM API (Phase 8).\n\n' +
      '**Setup**\n' +
      '1. Import this collection and `Mini-ERP-CRM.postman_environment.json`.\n' +
      '2. Select the *Mini ERP + CRM — Local* environment.\n' +
      '3. Run **Auth → Login (admin)**. It stores `{{token}}`; collection-level auth applies it ' +
      'to every other request, so nothing is pasted by hand.\n\n' +
      '**Where to start** — the *Workflow (end-to-end)* folder runs the whole story top to ' +
      'bottom: create a customer, create a product with opening stock, raise a challan, confirm ' +
      'it, and watch stock fall by exactly the quantity sold with a ledger row explaining why.\n\n' +
      '**Errors (these fail on purpose)** demonstrates the 4xx contract. Its tests assert the ' +
      'failures, so a green run there means the error handling is right.\n\n' +
      'Full reference: `docs/API_DOCUMENTATION.md`.',
    schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
  },
  auth: {
    type: 'bearer',
    bearer: [{ key: 'token', value: '{{token}}', type: 'string' }],
  },
  event: [
    {
      listen: 'test',
      script: {
        type: 'text/javascript',
        exec: [
          '// Applies to every request in the collection.',
          'pm.test("Responds with the standard envelope", function () {',
          '    if (pm.response.code === 204) return; // DELETE returns no body',
          '    const body = pm.response.json();',
          '    pm.expect(body).to.have.property("success");',
          '    pm.expect(body.success).to.eql(pm.response.code < 400);',
          '});',
        ],
      },
    },
  ],
  variable: [
    { key: 'baseUrl', value: 'http://localhost:4000/api', type: 'string' },
    { key: 'rootUrl', value: 'http://localhost:4000', type: 'string' },
  ],
  item: folders,
};

const environment = {
  id: 'e3a9c8d1-2f45-4b76-8c10-mini-erp-crm-env',
  name: 'Mini ERP + CRM — Local',
  values: [
    { key: 'baseUrl', value: 'http://localhost:4000/api', type: 'default', enabled: true },
    { key: 'rootUrl', value: 'http://localhost:4000', type: 'default', enabled: true },
    { key: 'token', value: '', type: 'secret', enabled: true },
    { key: 'salesToken', value: '', type: 'secret', enabled: true },
    { key: 'warehouseToken', value: '', type: 'secret', enabled: true },
    { key: 'customerId', value: '', type: 'default', enabled: true },
    { key: 'deleteCustomerId', value: '', type: 'default', enabled: true },
    { key: 'deleteMobile', value: '', type: 'default', enabled: true },
    { key: 'deleteStamp', value: '', type: 'default', enabled: true },
    { key: 'productId', value: '', type: 'default', enabled: true },
    { key: 'challanId', value: '', type: 'default', enabled: true },
    { key: 'draftChallanId', value: '', type: 'default', enabled: true },
    { key: 'wfCustomerId', value: '', type: 'default', enabled: true },
    { key: 'wfProductId', value: '', type: 'default', enabled: true },
    { key: 'wfChallanId', value: '', type: 'default', enabled: true },
    { key: 'runStamp', value: '', type: 'default', enabled: true },
    { key: 'runMobile', value: '', type: 'default', enabled: true },
    { key: 'runSku', value: '', type: 'default', enabled: true },
  ],
  _postman_variable_scope: 'environment',
};

mkdirSync(OUT, { recursive: true });
writeFileSync(`${OUT}/Mini-ERP-CRM.postman_collection.json`, JSON.stringify(collection, null, 2) + '\n');
writeFileSync(`${OUT}/Mini-ERP-CRM.postman_environment.json`, JSON.stringify(environment, null, 2) + '\n');

const count = folders.reduce((n, f) => n + f.item.length, 0);
console.log(`Wrote ${folders.length} folders, ${count} requests.`);
