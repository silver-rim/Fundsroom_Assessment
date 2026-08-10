# Product & Inventory Module

> Phase 4 deliverable. Product master, stock levels, low-stock alerting, and the append-only
> stock movement ledger.
> Related: [DATABASE_DESIGN.md](./DATABASE_DESIGN.md) · [API_PLAN.md](./API_PLAN.md) · [AUTHENTICATION.md](./AUTHENTICATION.md)

---

## 1. What the module does

Answers three questions a distributor asks constantly:

1. **What do we sell, and at what price?** — the product master.
2. **How much is actually on the shelf?** — one authoritative `current_stock` per product.
3. **Who changed it, when, and why?** — the movement ledger.

The whole module is built around one invariant:

> **`products.current_stock` always equals the sum of that product's movements, and can never be
> negative.**

Everything below exists to make that true even under concurrent use and partial failure.

---

## 2. The central rule: stock only moves through the ledger

There is no "edit current stock" field. Not on the form, not in the API.

```text
Create product ──► stock = 0, always
       │
       ├── opening stock > 0 ──► IN movement "Opening stock"  ──► stock rises
       │                          (same transaction as the insert)
       │
       ├── goods received  ────► IN  movement + reason        ──► stock rises
       ├── damage / write-off ─► OUT movement + reason        ──► stock falls
       │                          rejected if it would go below zero
       │
       └── challan confirmed ──► OUT movement, reference_type = SALES_CHALLAN   (Phase 5)
```

`PUT /api/products/:id` accepts every descriptive field but **rejects `currentStock` with a 422**:

```json
{ "field": "body.currentStock",
  "message": "currentStock cannot be edited directly. Record a stock movement instead." }
```

Zod strips unknown keys by default, so silently dropping the field was the easy option — but the
caller would then believe the change had been applied. Failing loudly teaches the rule instead.

**Why it matters.** If stock could be typed in directly, the number and the ledger would drift apart
within a week, and neither would be trustworthy. Forcing every change through a movement means the
current figure is always *derivable* — and therefore auditable.

---

## 3. How stock changes are made safe

`stockMovement.service.recordMovement` runs entirely inside one transaction:

```text
BEGIN
  SELECT … FROM products WHERE id = $1 FOR UPDATE     ← row lock
  newBalance = IN ? stock + qty : stock - qty
  if newBalance < 0 → throw 409 INSUFFICIENT_STOCK    ← ROLLBACK, nothing written
  UPDATE products SET current_stock = newBalance
  INSERT INTO stock_movements (…, balance_after = newBalance)
COMMIT
```

**The row lock is the point.** Without `FOR UPDATE`, two simultaneous OUT movements could both read
`stock = 5`, both conclude that removing 4 is fine, and leave the product at `-3`. The lock serialises
them: the second transaction waits, then reads `1` and is correctly refused.

This was verified rather than assumed — see the concurrency test in §8.

**Three independent layers protect the invariant:**

| Layer | Mechanism | What it catches |
| --- | --- | --- |
| Application | `newBalance < 0` check under a row lock | Normal over-issue, with a readable message |
| Database | `CHECK (current_stock >= 0)` | A bug in the layer above — the transaction aborts instead of persisting bad stock |
| Database | `CHECK (balance_after >= 0)`, `CHECK (quantity > 0)` | A malformed ledger row |

The `CHECK` constraint has never fired in testing. That is the point of a backstop.

---

## 4. Data model

Tables `products` and `stock_movements` — full detail in
[DATABASE_DESIGN.md §3.4 and §3.5](./DATABASE_DESIGN.md).

### Product fields

| Field | Type | Required | Notes |
| --- | --- | :---: | --- |
| `name` | text 2–150 | ✔ | |
| `sku` | 2–50, `[A-Za-z0-9_-]` | ✔ | **Unique**, stored upper-cased |
| `category` | text 2–80 | ✔ | Free text; a `categories` table would be premature |
| `unitPrice` | `NUMERIC(12,2)` | ✔ | Decimal **string** end to end — never a float |
| `currentStock` | integer ≥ 0 | — | **Read-only via the API** |
| `minStockAlert` | integer ≥ 0 | ✔ | Low-stock threshold |
| `location` | text 1–100 | ✔ | Descriptive label, not a separate stock bucket (assumption A2) |
| `isActive` | boolean | — | Deactivated instead of deleted |
| `isLowStock` | derived | — | `current_stock <= min_stock_alert`, computed in SQL |

**Money never becomes a float.** `unitPrice` arrives as a string, is validated as a string, and is
bound to `NUMERIC(12,2)` as a string. Parsing `"1250.00"` into a JS number and back would reintroduce
exactly the rounding error the `NUMERIC` column exists to prevent.

**Low stock is derived, never stored.** A stored flag would need updating on every stock change *and*
every threshold change, and would be wrong the moment one was missed.

### Movement fields

| Field | Notes |
| --- | --- |
| `movementType` | `IN` or `OUT` — direction lives here |
| `quantity` | Always a **positive magnitude** |
| `reason` | **Mandatory**, 3–255 chars. Every change must be explainable months later |
| `balanceAfter` | Stock immediately after this row — the ledger's running balance |
| `referenceType` | `MANUAL` or `SALES_CHALLAN` |
| `referenceId` | The challan id when system-generated |
| `createdBy` | Who did it |

Storing `balance_after` makes the ledger auditable without replaying it from the beginning, and makes
a break in the chain visible at a glance.

**The table is append-only.** There is no update and no delete in the repository — by design. A
correction is a new movement in the opposite direction with its own reason, so the ledger stays a
truthful record of what actually happened rather than what someone later wished had happened.

---

## 5. API endpoints

All require authentication.

| Method | Path | Roles | Purpose |
| --- | --- | --- | --- |
| `GET` | `/api/products` | All | List with search, filters, sort, pagination |
| `GET` | `/api/products/categories` | All | Distinct categories, for the filter dropdown |
| `POST` | `/api/products` | Admin, Warehouse | Create (+ optional opening stock) |
| `GET` | `/api/products/:id` | All | Detail incl. `isLowStock` |
| `PUT` | `/api/products/:id` | Admin, Warehouse | Update — **cannot** change stock |
| `PATCH` | `/api/products/:id/status` | Admin, Warehouse | Activate / deactivate |
| `GET` | `/api/products/:id/movements` | All | This product's ledger |
| `GET` | `/api/stock-movements` | All | Global ledger with filters |
| `POST` | `/api/stock-movements` | Admin, Warehouse | Record a manual IN / OUT |

`/products/categories` is declared **before** `/products/:id` in the router — otherwise Express would
match the literal path as an id and the request would fail validation with a 400.

### Query parameters

**`GET /api/products`** — `page`, `limit`, `search` (name / SKU / category), `category`,
`lowStock=true`, `isActive=true|false|all` (default `true`), `sortBy` (`createdAt`, `name`, `sku`,
`category`, `unitPrice`, `currentStock`), `sortOrder`.

Deactivated products are hidden by default: they cannot be sold, so they would be noise on the
screen a warehouse user reads every day.

**`GET /api/stock-movements`** — `page`, `limit`, `productId`, `movementType`, `referenceType`,
`createdBy`, `dateFrom`, `dateTo`.

`dateTo` is applied as `created_at < dateTo + 1 day`, so a movement recorded at 14:30 on the end date
is included. Comparing against the bare date would silently exclude everything after midnight.
`dateFrom > dateTo` is rejected with a 422 rather than quietly returning nothing.

### Insufficient stock

```jsonc
// POST /api/stock-movements  { productId: 6, movementType: "OUT", quantity: 1, … }
{
  "success": false,
  "error": {
    "code": "INSUFFICIENT_STOCK",
    "message": "Insufficient stock for Aluminium Ladder 8ft. Available: 0, Requested: 1.",
    "details": [ { "field": "body.quantity", "message": "Only 0 in stock" } ]
  }
}
```

**409, not 400.** The request is perfectly well-formed; it conflicts with the current state of the
world. The message names the product and both real numbers, because "insufficient stock" alone does
not tell anyone what to do next.

---

## 6. Role access

| Action | Admin | Sales | Warehouse | Accounts |
| --- | :---: | :---: | :---: | :---: |
| List / view products | ✔ | ✔ (read) | ✔ | ✔ (read) |
| Create / edit product | ✔ | ✖ | ✔ | ✖ |
| Activate / deactivate | ✔ | ✖ | ✔ | ✖ |
| View stock ledger | ✔ | ✔ (read) | ✔ | ✔ (read) |
| Record manual movement | ✔ | ✖ | ✔ | ✖ |

Sales can *see* stock — they must know what is available before promising a delivery — but can never
adjust a figure by hand. That is a warehouse responsibility, and Phase 5's challan confirmation is
the only route by which a sales action moves stock.

---

## 7. Frontend

| Screen | Route | Notes |
| --- | --- | --- |
| Product list | `/products` | Search, category, active and low-stock filters, pagination |
| Product detail | `/products/:id` | Stock cards, details, movement form, ledger table |
| Add / edit product | `/products/new`, `/products/:id/edit` | Admin & Warehouse only |
| Inventory ledger | `/inventory` | Global movement audit with type, source and date filters |

**Stock status is a three-way badge**, not two: `Out of stock` (red) is separated from `Low stock`
(amber) because they demand different actions — one blocks a sale outright, the other is a reorder
reminder.

**Numbers are right-aligned with `tabular-nums`**, so quantities and prices line up down a column and
can be compared at a glance. Low values render in red and bold.

**The product form has no stock input**, and in edit mode shows an explicit note pointing to
*Record movement*. The rule is taught in the UI, not just enforced by the API.

**The movement form surfaces the server's 409 verbatim** — "Insufficient stock for X. Available: 2,
Requested: 5." — rather than replacing it with a generic failure message.

**Stock value** (`unit price × current stock`) is shown on the detail page as a second stat card.
It is derived for display only and never stored.

---

## 8. Test results

Executed against the running API on 2026-08-10.

### Products

| # | Case | Expected | Actual | ✓ |
| --- | --- | --- | --- | --- |
| 1 | List with pagination | 10 products | 10 | ✅ |
| 2 | `?lowStock=true` | 4 products | CF-1200, ALU-LDR-8, MCB-32-SP, LED-PL-18 | ✅ |
| 3 | Boundary: stock == threshold (26/26) | flagged low | `isLowStock: true` | ✅ |
| 4 | `/products/categories` | 6 distinct | Appliances…Tools | ✅ |
| 5 | `?category=Switchgear` | 3 | 3 | ✅ |
| 6 | `?search=mcb` matches SKU | 1 | MCB 32A Single Pole | ✅ |
| 7 | Create with `sku: "tst-ct-200"` | upper-cased | `TST-CT-200` | ✅ |
| 8 | Duplicate SKU (different case) | 409 | `DUPLICATE_SKU` | ✅ |
| 9 | **`PUT` with `currentStock`** | **422** | teaching message returned | ✅ |
| 10 | Deactivate | 200, hidden from default list | hidden; visible with `isActive=all` | ✅ |

### Stock movements

| # | Case | Expected | Actual | ✓ |
| --- | --- | --- | --- | --- |
| 11 | Opening stock 500 on create | IN movement, not a direct write | `IN 500, "Opening stock", balanceAfter 500`, by Farid Ali | ✅ |
| 12 | IN 250 | balance 750 | 750 | ✅ |
| 13 | OUT 50 | balance 700 | 700 | ✅ |
| 14 | **OUT 99,999 against 700** | **409** | `Insufficient stock for Test Cable Tie 200mm. Available: 700, Requested: 99999.` | ✅ |
| 15 | **Stock after the rejected OUT** | **unchanged at 700** | 700 — the rollback left nothing behind | ✅ |
| 16 | OUT 1 from a zero-stock product | 409 | `Available: 0, Requested: 1` | ✅ |
| 17 | Ledger net == `current_stock` | equal | 700 == 700 | ✅ |
| 18 | `quantity: 0`, `reason: "x"` | 422, both fields | both returned | ✅ |
| 19 | `dateFrom > dateTo` | 422 | "dateFrom must be on or before dateTo" | ✅ |
| 20 | Ledger integrity across **all** products | 0 mismatches | 0 | ✅ |

### Concurrency — the row lock under real contention

**16 simultaneous `OUT 1` requests against a product holding exactly 10 units.**

| Measure | Expected | Actual | ✓ |
| --- | --- | --- | --- |
| `201 Created` | exactly 10 | **10** | ✅ |
| `409 Rejected` | exactly 6 | **6** | ✅ |
| Any other status | none | none | ✅ |
| Final stock | 0, never below | **0** | ✅ |
| Ledger rows | 11 (1 opening IN + 10 OUT) | 11 | ✅ |
| `balanceAfter` trail | strictly decreasing, no repeats | `10,9,8,7,6,5,4,3,2,1,0` | ✅ |

The `balanceAfter` sequence is the strongest evidence: no two transactions read the same starting
balance, so none of them raced. Without `FOR UPDATE` this test would show duplicated balances and a
negative final stock.

### Authorization

| # | Route | Admin | Sales | Warehouse | Accounts | ✓ |
| --- | --- | --- | --- | --- | --- | --- |
| 21 | `GET /products` | 200 | 200 | 200 | 200 | ✅ |
| 22 | `POST /products` | 201 | **403** | 201 | **403** | ✅ |
| 23 | `PATCH /products/:id/status` | 200 | **403** | 200 | **403** | ✅ |
| 24 | `GET /stock-movements` | 200 | 200 | 200 | 200 | ✅ |
| 25 | `POST /stock-movements` | 201 | **403** | 201 | **403** | ✅ |

**25 of 25 passed**, plus the 6-measure concurrency test.

---

## 9. Known limitations

1. **The low-stock filter cannot use an index.** `current_stock <= min_stock_alert` compares two
   columns, so it is a sequential scan. At a few thousand products that is a few milliseconds. A
   generated column with an index would fix it if the catalogue ever grew large.
2. **One stock figure per product** (assumption A2). `location` is a descriptive label, not a
   separate bucket. Per-warehouse stock needs a `product_stock_by_location` table.
3. **Movements can be recorded against a deactivated product.** Deliberate — writing off remaining
   stock of a discontinued item is a real need. Deactivation blocks *selling*, not correcting.
4. **No reorder suggestions or purchase orders.** Low stock is flagged; deciding what to buy is
   still a human job. Purchase orders are out of MVP scope (assumption A15).
5. **Products cannot be hard-deleted.** `stock_movements` and `sales_challan_items` reference them
   with `ON DELETE RESTRICT`, so deletion would mean destroying history. Deactivation is the
   intended path.
6. **No stock valuation method** (FIFO / weighted average). Stock value on the detail page is simply
   `current unit price × quantity`, which is a display figure, not an accounting one.
7. **Categories are free text.** A typo creates a new category. A lookup table would fix it, at the
   cost of a management screen this MVP does not need.
