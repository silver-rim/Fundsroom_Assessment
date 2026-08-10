# Sales Challan Module

> Phase 5 deliverable. The core of the assignment: challan lifecycle, transactional stock
> deduction, and the product snapshot that keeps historical documents immutable.
> Related: [INVENTORY_MODULE.md](./INVENTORY_MODULE.md) · [DATABASE_DESIGN.md](./DATABASE_DESIGN.md) · [API_PLAN.md](./API_PLAN.md)

---

## 1. What a challan is

A **delivery note**: the document that accompanies goods leaving the warehouse for a customer. It
lists what was sent, in what quantity, at what price, on what date, and who authorised it.

Three properties make it different from a shopping cart:

1. **It has a lifecycle.** A draft is a proposal; confirming it is a commitment that moves real stock.
2. **It is a financial record.** Once confirmed it must never change, even if the underlying products do.
3. **It must be all-or-nothing.** A half-dispatched challan is not a business state that exists.

---

## 2. The workflow

```text
Sales selects a customer, adds product lines with quantities
        │
        ├── SAVE AS DRAFT ──────────► challan_number assigned (CH-2026-000001)
        │                             status = DRAFT
        │                             ⚠ stock is NOT touched
        │                             freely editable, freely cancellable
        │
        ├── EDIT ───────────────────► replace customer / lines / notes (DRAFT only)
        │
        ├── CANCEL ─────────────────► status = CANCELLED, stock still untouched
        │
        └── CONFIRM ────────────────► ONE transaction:
                 │                      1. lock the challan row
                 │                      2. lock every product row (ordered by id)
                 │                      3. verify EVERY line has enough stock
                 │                      4. any shortfall → abort everything, 409
                 │                      5. deduct stock on each product
                 │                      6. write one OUT movement per line,
                 │                         referencing this challan
                 │                      7. refresh each line's snapshot
                 │                      8. recompute totals
                 │                      9. status = CONFIRMED + who + when
                 │
                 └──► the challan becomes immutable
```

**Terminal states are terminal.** `CONFIRMED` and `CANCELLED` cannot be edited, re-confirmed or
cancelled. The only legal transitions are `DRAFT → CONFIRMED` and `DRAFT → CANCELLED`.

---

## 3. Draft vs Confirmed

| | DRAFT | CONFIRMED |
| --- | --- | --- |
| Stock | **Untouched** | Deducted, one `OUT` movement per line |
| Editable | Yes | No |
| Cancellable | Yes | No — needs a stock return |
| Line snapshot | Taken, but refreshed on confirm | **Frozen forever** |
| Challan number | Assigned immediately | Unchanged |
| Ledger entries | None | One per line, `reference_type = SALES_CHALLAN` |

**Why a draft reserves nothing.** Reserving stock would mean a second concept — "committed but not
dispatched" — with its own expiry rules and its own reconciliation problems. For a small distributor,
a draft that does nothing until confirmed is simpler and easier to trust. The cost is that two drafts
can promise the same units; the first to confirm wins, and the second gets a clear
`INSUFFICIENT_STOCK` error. That is exactly what happens on a real shop floor.

---

## 4. Transaction safety

`challanService.confirmChallan` is the most carefully written function in the project.

```text
BEGIN
  SELECT … FROM sales_challans  WHERE id = $1 FOR UPDATE     ← lock the document
  assert status = 'DRAFT'                                    → else 409 INVALID_STATE
  assert item count > 0                                      → else 409 INVALID_STATE

  SELECT … FROM products WHERE id = ANY($1) ORDER BY id FOR UPDATE   ← lock every product

  ── pass 1: verify ────────────────────────────────────────
  for each line: collect a shortfall if current_stock < quantity
  if any shortfalls → throw 409 INSUFFICIENT_STOCK (ALL of them)     → ROLLBACK

  ── pass 2: apply ─────────────────────────────────────────
  for each line:
      UPDATE products SET current_stock = current_stock - qty
      INSERT stock_movements (OUT, balance_after, ref = this challan)
      UPDATE sales_challan_items SET name/sku/price = live values     ← snapshot refresh
  recompute totals from the item rows
  UPDATE sales_challans SET status='CONFIRMED', confirmed_by, confirmed_at
COMMIT
```

Four separate decisions make this safe:

**1. Two passes, not one.** Verifying every line before touching anything means a failure on line 4
does not leave lines 1–3 decremented. The transaction would roll that back anyway — but two passes
also let the API report **every** failing line at once, so the user fixes the whole challan in one
go instead of discovering shortfalls one confirmation attempt at a time.

**2. Products are locked in `id` order.** `lockByIds` ends with `ORDER BY id … FOR UPDATE`. If two
challans share products and locked them in the order they happened to be listed, one could hold
product 7 while waiting for 3, and the other the reverse — a deadlock. A consistent order makes that
impossible.

**3. The challan row itself is locked.** Without it, two simultaneous confirmations of the same
challan could both read `status = 'DRAFT'` and both deduct. Verified in testing: 8 concurrent
confirmations produced exactly 1 success and 7 × 409.

**4. The database is the backstop.** `CHECK (current_stock >= 0)` still guards every write. If the
service logic were wrong, the transaction aborts rather than persisting negative stock.

### Insufficient stock

```jsonc
{
  "success": false,
  "error": {
    "code": "INSUFFICIENT_STOCK",
    "message": "Insufficient stock for MCB 32A Single Pole. Available: 8, Requested: 500.",
    "details": [
      { "field": "items[2].quantity",
        "message": "MCB 32A Single Pole (MCB-32-SP) — available 8, requested 500" },
      { "field": "items[0].quantity",
        "message": "Copper Wire 2.5mm (100m) (CW-25-100M) — available 116, requested 9999" }
    ]
  }
}
```

**409, not 400 or 500.** The request is valid; it conflicts with the current state of the world.
The message names the product and both real numbers. No stack trace ever reaches the client.

---

## 5. Product snapshot

**The requirement the case study calls out explicitly**, and the reason `sales_challan_items` stores
more than a foreign key.

Each line stores:

| Column | Purpose |
| --- | --- |
| `product_id` | Live link — powers "how many of this have we ever dispatched?" |
| `product_name` | 📸 the name **at the moment of sale** |
| `product_sku` | 📸 the SKU **at the moment of sale** |
| `unit_price` | 📸 the price **at the moment of sale** |
| `quantity` | |
| `line_total` | `GENERATED ALWAYS AS (unit_price * quantity) STORED` — cannot disagree with its inputs |

**Why duplication is correct here.** Normalisation says store the id and join. That is wrong for a
commercial document. If the warehouse renames `Copper Wire 2.5mm (100m)` to
`Copper Wire 2.5sqmm - Premium` and raises the price 8%, a join-based challan would silently rewrite
last month's dispatch and stop matching the paper copy the customer signed. Verified in testing: after
exactly that rename and reprice, the confirmed challan still reads `Copper Wire 2.5mm (100m)`,
`CW-25-100M`, `1250.00`, total `9400.00` — while `productId` still resolves to the live, renamed product.

**When the snapshot is taken.** At draft creation *and again at confirmation*. A draft sitting for a
month should bill at the price in force when the goods actually leave, not the price when someone
started typing. Confirmation is the moment of sale, so that is the moment frozen.

**Prices are never accepted from the client.** A challan line request carries only `productId` and
`quantity`. Names, SKUs and prices are read server-side from the products table, so no caller can
dictate what something sold for.

---

## 6. Challan numbering

```sql
'CH-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('challan_number_seq')::text, 6, '0')
-- CH-2026-000001
```

`nextval` is atomic and non-blocking, so two users creating a challan in the same instant always get
different numbers. `SELECT max(challan_number) + 1` would race precisely under the load where
correctness matters, and `UNIQUE (challan_number)` would then reject one of them.

The counter does not reset annually (assumption A12) — the year in the prefix is the year of issue,
and the sequence stays globally unique.

---

## 7. API endpoints

| Method | Path | Roles | Purpose |
| --- | --- | --- | --- |
| `GET` | `/api/challans` | All | List with search, status and date filters |
| `POST` | `/api/challans` | Admin, Sales | Create draft, or create + confirm |
| `GET` | `/api/challans/:id` | All | Header + line items |
| `PUT` | `/api/challans/:id` | Admin, Sales | Replace a **draft's** customer / items / notes |
| `POST` | `/api/challans/:id/confirm` | Admin, Sales, **Warehouse** | ⚡ Transactional stock deduction |
| `POST` | `/api/challans/:id/cancel` | Admin, Sales | Cancel a draft |
| `GET` | `/api/customers/:id/challans` | All | This customer's challans *(deferred from Phase 3)* |

**Warehouse can confirm but not create.** Confirmation is the moment goods physically leave the
building, which is a warehouse action. Pricing and raising the document is a sales action.

### Create

```jsonc
POST /api/challans
{
  "customerId": 1,
  "items": [ { "productId": 1, "quantity": 4 }, { "productId": 2, "quantity": 10 } ],
  "notes": "Deliver to the Surat godown.",
  "confirmImmediately": false
}
```

`confirmImmediately: true` runs creation **and** confirmation in one transaction — the "Save &
confirm" button. On insufficient stock **nothing is written at all**, not even the draft. Verified:
the challan count was identical before and after a failed immediate-confirm.

### Filters on `GET /api/challans`

`page`, `limit`, `search` (challan number, business name or contact name), `status`, `customerId`,
`createdBy`, `dateFrom`, `dateTo`, `sortBy` (`createdAt`, `challanNumber`, `totalAmount`, `status`),
`sortOrder`.

---

## 8. Validation

| Rule | Response |
| --- | --- |
| At least one line item | 422 "Add at least one product" |
| No duplicate products on one challan | 422 naming the earlier line number |
| Quantity is a positive whole number | 422 |
| Max 100 line items | 422 |
| Customer exists | 404 |
| Customer is not soft-deleted | 404 |
| Customer is not `INACTIVE` | 409 `INVALID_STATE` |
| Every product exists and is active | 409 `INVALID_STATE`, all problems listed |
| Challan is `DRAFT` before edit / confirm / cancel | 409 `INVALID_STATE` |
| Enough stock for every line | 409 `INSUFFICIENT_STOCK`, all shortfalls listed |

**Duplicate products are rejected, not merged.** The database has `UNIQUE (challan_id, product_id)`,
and silently summing two lines would hide a data-entry mistake the user should see.

**A `LEAD` customer is allowed.** A first order is exactly how a lead becomes a customer. Only an
explicitly `INACTIVE` account is refused — this is a deliberate refinement of rule SVC8 in
`DATABASE_DESIGN.md`, which read as "ACTIVE only".

---

## 9. Frontend

| Screen | Route | Notes |
| --- | --- | --- |
| Challan list | `/challans` | Search, status filter, date range, pagination |
| Challan detail | `/challans/:id` | Line items, customer, audit trail, confirm/cancel |
| New challan | `/challans/new` | Dynamic rows, live stock, running totals |
| Edit draft | `/challans/:id/edit` | Same component; drafts only |

**Live stock per line.** As a product is chosen, the row shows its unit price, current stock and line
total. Requesting more than is available turns the row red *before* submission — the user is warned
rather than surprised by a 409.

**Draft state is unmissable.** An amber banner states that stock has not been deducted and that
confirming will reduce it. The confirm button says "Confirm & deduct stock", and asks for
confirmation first.

**Errors show every failing line.** The 409's `details` array is rendered as a list, and server-side
line errors (`items[2].quantity`) are mapped back onto the matching row in the form.

**Confirmed challans display a snapshot note** explaining that the line details will not change if a
product is later renamed or repriced.

**Role-aware actions.** Edit/Cancel appear for Admin and Sales; Confirm additionally for Warehouse;
Accounts sees a read-only document. All cosmetic — the API enforces the same rules.

---

## 10. Test results

Executed against the running API on 2026-08-10.

### Draft lifecycle

| # | Case | Expected | Actual | ✓ |
| --- | --- | --- | --- | --- |
| 1 | Create draft as Sales | 201, `DRAFT` | `CH-2026-000001`, DRAFT | ✅ |
| 2 | Challan number format | `CH-YYYY-NNNNNN` | matched | ✅ |
| 3 | Totals computed | qty 14, ₹9400.00 | 14 / 9400.00 | ✅ |
| 4 | **Draft does not touch stock** | 120 and 300 unchanged | **both unchanged** | ✅ |
| 5 | Snapshot captured at draft | name/SKU/price stored | stored | ✅ |
| 6 | Cancel a draft | 200, `CANCELLED` | cancelled, reason appended to notes | ✅ |
| 7 | Confirm a cancelled challan | 409 | `INVALID_STATE` | ✅ |

### Confirmation

| # | Case | Expected | Actual | ✓ |
| --- | --- | --- | --- | --- |
| 8 | Confirm as **Warehouse** | 200, `CONFIRMED` | confirmed by Farid Ali | ✅ |
| 9 | **Stock deducted** | 120→116, 300→290 | exactly that | ✅ |
| 10 | One OUT movement per line | 2 movements | 2, `reason: "Sales challan CH-2026-000001"` | ✅ |
| 11 | Movements linked to challan | `SALES_CHALLAN#1` | correct | ✅ |
| 12 | `balance_after` recorded | 116 and 290 | correct | ✅ |
| 13 | Re-confirm | 409 | "has already been confirmed" | ✅ |
| 14 | Edit a confirmed challan | 409 | `INVALID_STATE` | ✅ |
| 15 | Cancel a confirmed challan | 409 | "Record a stock return instead" | ✅ |

### All-or-nothing — the critical test

3-line draft: lines 1 and 2 have stock, line 3 requests 500 of a product holding 8.

| # | Measure | Expected | Actual | ✓ |
| --- | --- | --- | --- | --- |
| 16 | Response | 409 `INSUFFICIENT_STOCK` | "Available: 8, Requested: 500." | ✅ |
| 17 | **Line 1 stock (had enough)** | **untouched** | 116 → 116 | ✅ |
| 18 | **Line 2 stock (had enough)** | **untouched** | 450 → 450 | ✅ |
| 19 | Line 3 stock | untouched | 8 → 8 | ✅ |
| 20 | Challan status | still `DRAFT` | DRAFT | ✅ |
| 21 | Stray OUT movements | none | count unchanged at 2 | ✅ |
| 22 | Multiple shortfalls | **all** reported | 2 of 2 listed | ✅ |

### Product snapshot — the case study's explicit requirement

Renamed `Copper Wire 2.5mm (100m)` → `Copper Wire 2.5sqmm (100m) - Premium`, changed SKU
`CW-25-100M` → `CW-25-100M-V2`, raised price `1250.00` → `1350.00`, then re-read the confirmed challan.

| # | Field | Expected | Actual | ✓ |
| --- | --- | --- | --- | --- |
| 23 | `productName` | unchanged | `Copper Wire 2.5mm (100m)` | ✅ |
| 24 | `productSku` | unchanged | `CW-25-100M` | ✅ |
| 25 | `unitPrice` | unchanged | `1250.00` | ✅ |
| 26 | `lineTotal` / `totalAmount` | unchanged | `5000.00` / `9400.00` | ✅ |
| 27 | `productId` still resolves live | new name | `Copper Wire 2.5sqmm - Premium` | ✅ |

### Immediate confirm

| # | Case | Expected | Actual | ✓ |
| --- | --- | --- | --- | --- |
| 28 | `confirmImmediately: true` | 201, `CONFIRMED`, stock down | 450 → 425 | ✅ |
| 29 | **…with insufficient stock** | 409, **no draft created** | challan count unchanged | ✅ |

### Concurrency — 8 simultaneous confirmations of one challan (30 units)

| Measure | Expected | Actual | ✓ |
| --- | --- | --- | --- |
| `200 OK` | exactly 1 | **1** | ✅ |
| `409` | exactly 7 | **7** | ✅ |
| Stock deducted | once (1200 → 1170) | **1170** | ✅ |
| OUT movements | exactly 1 | **1** | ✅ |

### Validation & authorization

| # | Case | Expected | Actual | ✓ |
| --- | --- | --- | --- | --- |
| 30 | Empty items | 422 | "Add at least one product" | ✅ |
| 31 | Duplicate product | 422 | names the earlier line | ✅ |
| 32 | Zero quantity | 422 | "must be greater than zero" | ✅ |
| 33 | INACTIVE customer | 409 | names the business | ✅ |
| 34 | Unknown customer | 404 | `NOT_FOUND` | ✅ |
| 35 | Unknown product | 409 | "Product 9999 does not exist" | ✅ |
| 36 | List as all four roles | 200 ×4 | 200 ×4 | ✅ |
| 37 | Create as Warehouse / Accounts | 403 | 403 both | ✅ |
| 38 | Confirm as Accounts | 403 | 403 | ✅ |
| 39 | Confirm as Warehouse | permitted | reached the handler | ✅ |
| 40 | Cancel as Warehouse / Accounts | 403 | 403 both | ✅ |
| 41 | `GET /customers/1/challans` | 200 | 200 | ✅ |

**41 of 41 passed**, plus the 4-measure concurrency test.

After testing, all test challans were removed and product stock recomputed from the remaining
opening movements — the demo database is back to exact seed state with **0 ledger mismatches**.

---

## 11. Known limitations

1. **A confirmed challan cannot be cancelled** (assumption A9). Reversing a dispatch means putting
   stock back, which is a returns flow with its own IN movements and paperwork. Allowing it here
   would let anyone inflate inventory by confirming and cancelling repeatedly.
2. **Drafts do not reserve stock.** Two drafts can promise the same units; the first to confirm wins.
   Reservation would need a "committed" quantity with expiry rules — real complexity for a rare problem.
3. **Prices refresh on confirmation.** A long-lived draft bills at the price in force when goods
   leave. Defensible, but it means the total shown on a draft is a preview, not a quote. A quotation
   module with locked pricing would be the correct answer if the business needed one.
4. **No PDF export.** Listed as a case-study bonus; not implemented.
5. **No partial dispatch.** A challan ships in full or not at all — no back-orders.
6. **No tax lines.** GST is stored on the customer for reference; challans carry no tax computation
   (assumption A5).
7. **The customer and product pickers load up to 100 records.** Fine for a demo dataset; a real
   deployment needs a searchable async picker.
8. **No invoice generated from a challan.** Invoicing is out of MVP scope (assumption A15).
