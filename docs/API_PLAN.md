# API Plan — Mini ERP + CRM Operations Portal

> Phase 0 deliverable: the **planned** REST surface, agreed before any handler is written.
> The implemented reference (with full request/response examples per endpoint) becomes
> `docs/API_DOCUMENTATION.md` in Phase 8, alongside the Postman collection.

---

## 1. Conventions

| Aspect | Convention |
| --- | --- |
| Base path | All routes are mounted under **`/api`** — e.g. the case study's `POST /auth/login` is served as `POST /api/auth/login`. The prefix keeps the API namespaced and CORS rules obvious. |
| Base URL | Local `http://localhost:4000`, production `https://<render-service>.onrender.com` |
| Format | JSON in, JSON out. `Content-Type: application/json`. Request bodies capped at 100 kB. |
| Naming | Plural, lower-case, hyphen-free resource nouns. Sub-resources nest one level (`/customers/:id/follow-ups`). |
| Verbs | `GET` read · `POST` create · `PUT` full update · `PATCH` partial/state change · `DELETE` remove |
| Case | Request and response fields are **camelCase**; the database is snake_case and the repository layer maps between them. |
| Auth | `Authorization: Bearer <jwt>` on everything except `POST /api/auth/login` and `GET /api/health` |
| IDs | Positive integers. A non-numeric `:id` is a **400**, a well-formed id that does not exist is a **404**. |
| Dates | ISO-8601. Instants are UTC with `Z` (`2026-08-10T09:30:00.000Z`); `followUpDate` is a plain date (`2026-08-14`). |
| Money | JSON **string** with two decimals (`"1250.00"`) so no precision is lost crossing IEEE-754. |
| Enums | Sent and returned UPPER_SNAKE (`WHOLESALE`, `CONFIRMED`, `OUT`). The UI maps them to display labels. |
| Idempotency | `PUT` and `PATCH` are idempotent. `POST /challans/:id/confirm` is not: a second call returns 409 `INVALID_STATE`. |

### Response envelope

```jsonc
// single resource
{ "success": true, "data": { … } }

// collection
{ "success": true, "data": [ … ],
  "pagination": { "page": 1, "limit": 20, "total": 137, "totalPages": 7 } }

// error
{ "success": false,
  "error": { "code": "VALIDATION_ERROR", "message": "Request validation failed.",
             "details": [ { "field": "mobile", "message": "Must be 10–15 digits" } ] } }
```

### Common query parameters (list endpoints)

| Parameter | Type | Default | Notes |
| --- | --- | --- | --- |
| `page` | int ≥ 1 | `1` | |
| `limit` | int 1–100 | `20` | Values above 100 are rejected (422), not silently clamped |
| `search` | string ≤ 100 | — | Case-insensitive partial match over resource-specific fields |
| `sortBy` | enum | resource default | Whitelisted column names only — never interpolated into SQL |
| `sortOrder` | `asc` \| `desc` | `desc` | |

### Error codes

| HTTP | `code` | Raised when |
| --- | --- | --- |
| 400 | `BAD_REQUEST` | Malformed JSON, non-numeric id, unparseable query |
| 401 | `INVALID_CREDENTIALS` | Wrong email/password, or an inactive account |
| 401 | `UNAUTHENTICATED` | Missing or malformed `Authorization` header, bad signature |
| 401 | `TOKEN_EXPIRED` | Valid signature, expired token — the client logs out and redirects |
| 403 | `FORBIDDEN` | Authenticated, but the role is not permitted |
| 404 | `NOT_FOUND` | Resource absent or soft-deleted |
| 409 | `DUPLICATE_MOBILE` / `DUPLICATE_SKU` / `DUPLICATE_EMAIL` | Unique constraint conflict |
| 409 | `INVALID_STATE` | Illegal status transition (e.g. confirming a confirmed challan) |
| 409 | `INSUFFICIENT_STOCK` | A movement or confirmation would drive stock below zero |
| 422 | `VALIDATION_ERROR` | Well-formed request that fails schema validation |
| 500 | `INTERNAL_ERROR` | Unexpected server failure. Message is always generic |

---

## 2. Endpoint index

Role column = roles allowed to call the endpoint (Admin is implicitly included everywhere).

### 2.1 System

| # | Method | Path | Auth | Roles | Purpose |
| --- | --- | --- | --- | --- | --- |
| 1 | `GET` | `/api/health` | No | — | Liveness + database connectivity check (used by Render) |

### 2.2 Authentication — Phase 2

| # | Method | Path | Auth | Roles | Purpose |
| --- | --- | --- | --- | --- | --- |
| 2 | `POST` | `/api/auth/login` | No | — | Exchange email + password for a JWT |
| 3 | `GET` | `/api/auth/me` | Yes | All | Current user profile, used to rehydrate the session on refresh |

### 2.3 Customers — Phase 3

| # | Method | Path | Auth | Roles | Purpose |
| --- | --- | --- | --- | --- | --- |
| 4 | `GET` | `/api/customers` | Yes | All (Warehouse/Accounts read-only) | List with search, filters, pagination |
| 5 | `GET` | `/api/customers/:id` | Yes | All | Customer detail |
| 6 | `POST` | `/api/customers` | Yes | Admin, Sales | Create |
| 7 | `PUT` | `/api/customers/:id` | Yes | Admin, Sales | Update |
| 8 | `DELETE` | `/api/customers/:id` | Yes | Admin | Soft delete |
| 9 | `GET` | `/api/customers/:id/follow-ups` | Yes | Admin, Sales, Accounts | Follow-up history, newest first |
| 10 | `POST` | `/api/customers/:id/follow-ups` | Yes | Admin, Sales | Add a follow-up note |
| 11 | `GET` | `/api/customers/:id/challans` | Yes | All | Challans raised for this customer |

### 2.4 Products — Phase 4

| # | Method | Path | Auth | Roles | Purpose |
| --- | --- | --- | --- | --- | --- |
| 12 | `GET` | `/api/products` | Yes | All | List with search, category filter, low-stock filter, pagination |
| 13 | `GET` | `/api/products/:id` | Yes | All | Product detail incl. derived `isLowStock` |
| 14 | `POST` | `/api/products` | Yes | Admin, Warehouse | Create (with optional opening stock, which writes an IN movement) |
| 15 | `PUT` | `/api/products/:id` | Yes | Admin, Warehouse | Update — **cannot** change `currentStock` |
| 16 | `PATCH` | `/api/products/:id/status` | Yes | Admin, Warehouse | Activate / deactivate |
| 17 | `GET` | `/api/products/:id/movements` | Yes | All except Sales-write | Movement history for one product |

### 2.5 Stock movements — Phase 4

| # | Method | Path | Auth | Roles | Purpose |
| --- | --- | --- | --- | --- | --- |
| 18 | `GET` | `/api/stock-movements` | Yes | Admin, Warehouse, Accounts, Sales (read) | Global ledger with filters |
| 19 | `POST` | `/api/stock-movements` | Yes | Admin, Warehouse | Record a manual IN or OUT movement |

### 2.6 Sales challans — Phase 5

| # | Method | Path | Auth | Roles | Purpose |
| --- | --- | --- | --- | --- | --- |
| 20 | `GET` | `/api/challans` | Yes | All | List with status/customer/date filters, search by number |
| 21 | `GET` | `/api/challans/:id` | Yes | All | Header + snapshot line items |
| 22 | `POST` | `/api/challans` | Yes | Admin, Sales | Create — as `DRAFT`, or straight to `CONFIRMED` via `confirmImmediately` |
| 23 | `PUT` | `/api/challans/:id` | Yes | Admin, Sales | Replace a **draft's** customer / items / notes |
| 24 | `POST` | `/api/challans/:id/confirm` | Yes | Admin, Sales, Warehouse | ⚡ Transactional stock deduction |
| 25 | `POST` | `/api/challans/:id/cancel` | Yes | Admin, Sales | Cancel a draft |

### 2.7 Dashboard — Phase 6

| # | Method | Path | Auth | Roles | Purpose |
| --- | --- | --- | --- | --- | --- |
| 26 | `GET` | `/api/dashboard/summary` | Yes | All | Counters + recent activity, all computed from live queries |

**26 endpoints total.** Nothing here exists "because REST" — every route backs a screen or a rule in
the case study.

---

## 3. Endpoint detail

### `POST /api/auth/login`

```jsonc
// request
{ "email": "admin@fundsroom.local", "password": "••••••••" }

// 200
{ "success": true,
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIs…",
    "expiresIn": 28800,
    "user": { "id": 1, "name": "Asha Menon", "email": "admin@fundsroom.local", "role": "ADMIN" }
  } }
```

| Outcome | Status | Code |
| --- | --- | --- |
| Missing/malformed fields | 422 | `VALIDATION_ERROR` |
| Unknown email, wrong password, **or inactive account** | 401 | `INVALID_CREDENTIALS` — deliberately identical for all three, so the endpoint cannot be used to discover which accounts exist |

---

### `GET /api/customers`

Extra query parameters: `status` (`LEAD|ACTIVE|INACTIVE`), `customerType`
(`RETAIL|WHOLESALE|DISTRIBUTOR`), `followUpBefore` (date), plus the common set.
`search` matches `name`, `businessName`, `mobile` and `email`, case-insensitively.
`sortBy` ∈ `createdAt | name | businessName | followUpDate` (default `createdAt desc`).

```jsonc
// 200
{ "success": true,
  "data": [
    { "id": 12, "name": "Ramesh Patel", "mobile": "9876543210",
      "email": "ramesh@sharmatraders.in", "businessName": "Sharma Traders",
      "gstNumber": "24AAACS1234F1Z5", "customerType": "WHOLESALE",
      "address": "14 MG Road, Surat, Gujarat 395003", "status": "ACTIVE",
      "followUpDate": "2026-08-14", "notes": "Prefers delivery before noon.",
      "createdBy": { "id": 2, "name": "Nikhil Rao" },
      "createdAt": "2026-07-02T06:11:04.221Z", "updatedAt": "2026-08-01T10:02:55.010Z" }
  ],
  "pagination": { "page": 1, "limit": 20, "total": 43, "totalPages": 3 } }
```

### `POST /api/customers` → 201

Body: `name`, `mobile`, `email`, `businessName`, `customerType`, `address` (required);
`gstNumber`, `status`, `followUpDate`, `notes` (optional; `status` defaults to `LEAD`).
Duplicate mobile → **409 `DUPLICATE_MOBILE`**, "A customer with this mobile number already exists."

### `PUT /api/customers/:id` → 200 · `DELETE /api/customers/:id` → 204 (soft delete, Admin only)

### `POST /api/customers/:id/follow-ups` → 201

```jsonc
{ "note": "Called about the pending 200-unit order. Will confirm on Monday.",
  "nextFollowUpDate": "2026-08-17" }
```
When `nextFollowUpDate` is present the service also updates `customers.followUpDate` in the same
transaction, so the CRM list and the note history never disagree (rule SVC9).

---

### `GET /api/products`

Extra query parameters: `category`, `lowStock` (`true` → only `current_stock <= min_stock_alert`),
`isActive` (default `true`), plus the common set. `search` matches `name`, `sku` and `category`.
`sortBy` ∈ `createdAt | name | sku | unitPrice | currentStock`.

```jsonc
{ "id": 7, "name": "Copper Wire 2.5mm", "sku": "CW-25-100M", "category": "Electrical",
  "unitPrice": "1250.00", "currentStock": 5, "minStockAlert": 20,
  "location": "Main Warehouse / Rack A-12", "isActive": true, "isLowStock": true,
  "createdBy": { "id": 3, "name": "Farid Ali" },
  "createdAt": "2026-06-18T04:20:00.000Z", "updatedAt": "2026-08-09T11:45:12.900Z" }
```

`isLowStock` is computed in SQL, never stored.

### `POST /api/products` → 201

Body: `name`, `sku`, `category`, `unitPrice`, `minStockAlert`, `location`, plus optional
`openingStock` (default 0). A non-zero `openingStock` writes an `IN` movement with reason
"Opening stock" in the same transaction — stock never appears from nowhere (rule A13).
Duplicate SKU → **409 `DUPLICATE_SKU`**.

### `PUT /api/products/:id` → 200

Accepts the same fields **except `currentStock`**, which is not editable through this route. Sending
it is a 422 with `"currentStock cannot be edited directly. Record a stock movement instead."` — the
error teaches the caller the rule instead of silently dropping the field.

---

### `POST /api/stock-movements` → 201

```jsonc
// request
{ "productId": 7, "movementType": "OUT", "quantity": 3, "reason": "Damaged during handling" }

// 201
{ "success": true,
  "data": { "id": 88, "productId": 7, "productName": "Copper Wire 2.5mm",
            "movementType": "OUT", "quantity": 3, "reason": "Damaged during handling",
            "balanceAfter": 2, "referenceType": "MANUAL", "referenceId": null,
            "createdBy": { "id": 3, "name": "Farid Ali" },
            "createdAt": "2026-08-10T09:14:22.104Z" } }
```

The write runs in a transaction: lock the product row (`SELECT … FOR UPDATE`), verify
`current_stock >= quantity` for an `OUT`, update the stock, insert the movement with `balance_after`.

| Outcome | Status | Code | Message |
| --- | --- | --- | --- |
| `OUT` exceeds stock | 409 | `INSUFFICIENT_STOCK` | `"Insufficient stock for Copper Wire 2.5mm. Available: 2, Requested: 3."` |
| `quantity <= 0`, missing `reason` | 422 | `VALIDATION_ERROR` | |
| Unknown `productId` | 404 | `NOT_FOUND` | |

`GET /api/stock-movements` filters: `productId`, `movementType`, `createdBy`, `dateFrom`, `dateTo`,
`referenceType`, plus pagination.

---

### `POST /api/challans` → 201

```jsonc
{ "customerId": 12,
  "items": [ { "productId": 7, "quantity": 4 },
             { "productId": 9, "quantity": 10 } ],
  "notes": "Deliver to the Surat godown.",
  "confirmImmediately": false }
```

`confirmImmediately: true` runs the create **and** the confirmation in a single transaction — the
"Save & Confirm" button on the create screen. On insufficient stock nothing is written at all, not
even the draft.

Validation: at least one item, no duplicate `productId`, every quantity a positive integer, the
customer must exist and not be soft-deleted, every product must exist and be active.
Prices and names are read from the products table server-side — **the client never sends a price.**

### `GET /api/challans/:id` → 200

```jsonc
{ "success": true,
  "data": {
    "id": 31, "challanNumber": "CH-2026-000042",
    "customer": { "id": 12, "name": "Ramesh Patel", "businessName": "Sharma Traders",
                  "mobile": "9876543210", "gstNumber": "24AAACS1234F1Z5" },
    "status": "CONFIRMED", "totalQuantity": 14, "totalAmount": "9400.00",
    "notes": "Deliver to the Surat godown.",
    "items": [
      { "id": 55, "productId": 7, "productName": "Copper Wire 2.5mm", "productSku": "CW-25-100M",
        "unitPrice": "1250.00", "quantity": 4, "lineTotal": "5000.00" },
      { "id": 56, "productId": 9, "productName": "PVC Conduit 20mm", "productSku": "PVC-20",
        "unitPrice": "440.00", "quantity": 10, "lineTotal": "4400.00" }
    ],
    "createdBy":   { "id": 2, "name": "Nikhil Rao" },
    "confirmedBy": { "id": 3, "name": "Farid Ali" },
    "createdAt":   "2026-08-10T09:20:00.000Z",
    "confirmedAt": "2026-08-10T09:31:47.512Z",
    "cancelledBy": null, "cancelledAt": null
  } }
```

`productName`, `productSku` and `unitPrice` are served from the **snapshot columns**, so this
response is identical a year later even if the product has been renamed and repriced.

### `POST /api/challans/:id/confirm` → 200 — the critical endpoint

No request body. Executes rule SVC1 as one transaction:

1. `SELECT … FOR UPDATE` the challan → 404 if absent, 409 `INVALID_STATE` if not `DRAFT`.
2. 409 `INVALID_STATE` if it has no items (rule SVC4).
3. `SELECT … FOR UPDATE` every referenced product, **ordered by `product_id`** so concurrent
   confirmations acquire locks in the same order and cannot deadlock.
4. Refresh each line's snapshot from the locked product row (rule SVC5) and check
   `current_stock >= quantity` for **every** line before changing anything.
5. On any shortfall → `ROLLBACK` and return the first failure:

```jsonc
{ "success": false,
  "error": {
    "code": "INSUFFICIENT_STOCK",
    "message": "Insufficient stock for Copper Wire 2.5mm. Available: 2, Requested: 4.",
    "details": [ { "field": "items[0].quantity",
                   "message": "Copper Wire 2.5mm (CW-25-100M) — available 2, requested 4" } ]
  } }
```

`details` lists **every** failing line, not just the first, so a user fixes the whole challan in one
pass instead of discovering shortfalls one at a time.

6. Otherwise: decrement each product, insert one `OUT` movement per line with
   `reference_type = 'SALES_CHALLAN'` and `reference_id = challan.id`, recompute the totals, set
   `status = 'CONFIRMED'` with `confirmed_by` / `confirmed_at`, `COMMIT`.

The `products.current_stock >= 0` check constraint is the backstop: if the service logic were ever
wrong, the transaction aborts rather than persisting negative stock.

### `POST /api/challans/:id/cancel` → 200

Optional `{ "reason": "Customer withdrew the order" }`. Only legal from `DRAFT`; cancelling a
`CONFIRMED` challan is 409 `INVALID_STATE` with an explanation that a stock-return flow is required
(assumption A9). No stock is touched.

---

### `GET /api/dashboard/summary` → 200

```jsonc
{ "success": true,
  "data": {
    "customers":  { "total": 43, "active": 28, "leads": 11, "followUpsDue": 5 },
    "products":   { "total": 31, "lowStock": 4, "outOfStock": 1, "inactive": 2 },
    "challans":   { "total": 96, "draft": 7, "confirmed": 85, "cancelled": 4,
                    "confirmedThisMonth": 18, "valueThisMonth": "742500.00" },
    "lowStockProducts": [ { "id": 7, "name": "Copper Wire 2.5mm", "sku": "CW-25-100M",
                            "currentStock": 2, "minStockAlert": 20 } ],
    "recentChallans":   [ { "id": 31, "challanNumber": "CH-2026-000042",
                            "customerName": "Sharma Traders", "status": "CONFIRMED",
                            "totalAmount": "9400.00", "createdAt": "2026-08-10T09:20:00.000Z" } ],
    "recentMovements":  [ { "id": 88, "productName": "Copper Wire 2.5mm", "movementType": "OUT",
                            "quantity": 3, "createdAt": "2026-08-10T09:14:22.104Z" } ]
  } }
```

Every number is a real aggregate query. `followUpsDue` counts non-deleted customers whose
`follow_up_date <= CURRENT_DATE`. There are no decorative statistics.

---

## 4. Validation plan

Every endpoint validates **body, params and query** through a Zod schema before the controller runs.
The inferred type is the DTO, so validation and typing cannot drift apart.

| Field | Rule |
| --- | --- |
| `email` | Trimmed, lower-cased, RFC-ish email shape, ≤ 254 chars |
| `password` (login) | Non-empty string, ≤ 128 chars — never logged, never echoed |
| `mobile` | 10–15 digits after stripping spaces/`+`/`-` |
| `gstNumber` | Optional; when present, the 15-character GSTIN pattern, upper-cased |
| `customerType`, `status`, `role`, `movementType` | Strict enum — an unknown value is 422, never coerced |
| `followUpDate`, `nextFollowUpDate` | `YYYY-MM-DD`, must be a real calendar date |
| `dateFrom` / `dateTo` | Valid dates; `dateFrom <= dateTo` |
| `sku` | 2–50 chars, `[A-Za-z0-9_-]`, upper-cased before storage |
| `unitPrice` | ≥ 0, at most 2 decimal places |
| `quantity`, `openingStock`, `minStockAlert` | Integer, `quantity > 0`, others ≥ 0, ≤ 1,000,000 |
| `items` | Non-empty array, ≤ 100 lines, no duplicate `productId` |
| `page` / `limit` | Coerced integers; `page ≥ 1`, `1 ≤ limit ≤ 100` |
| `sortBy` | Whitelisted enum mapped to a column name — user input never reaches the SQL string |
| `:id` params | Coerced positive integer, else 400 |
| Unknown body fields | **Stripped**, not rejected, so a slightly stale client is not broken by a new field |

All strings are trimmed before validation, and every SQL parameter is bound — no query is built by
string concatenation of user input.

---

## 5. Phase mapping

| Phase | Endpoints delivered |
| --- | --- |
| 1 | `GET /api/health` |
| 2 | 2–3 (auth) + `authenticate` / `authorize` middleware applied to the routes above |
| 3 | 4–11 (customers, follow-ups) |
| 4 | 12–19 (products, stock movements) |
| 5 | 20–25 (sales challans) |
| 6 | 26 (dashboard) + full frontend integration |
| 7 | No new endpoints — verification and fixes |
| 8 | `docs/API_DOCUMENTATION.md` + `postman/Mini-ERP-CRM.postman_collection.json` |
