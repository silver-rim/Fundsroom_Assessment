# Project Overview — Mini ERP + CRM Operations Portal

> Phase 0 deliverable. This document describes **what** we are building and **why**.
> For **how** it is built, see [ARCHITECTURE.md](./ARCHITECTURE.md), [DATABASE_DESIGN.md](./DATABASE_DESIGN.md) and [API_PLAN.md](./API_PLAN.md).

---

## 1. What the portal is

An internal, browser-based operations portal for a **wholesale / distribution company**.

It is a *mini* ERP + CRM: a single place where the company's employees manage the customers they
sell to, the products they hold in a warehouse, the stock movements of those products, and the
sales challans (delivery notes) raised against customers.

It is **not** a public website and **not** a customer-facing app. Every user is an employee who
signs in with a company account and sees only what their job role allows.

---

## 2. What business problem it solves

Today a small distributor typically runs on a mix of WhatsApp, phone calls, and spreadsheets.
That produces four recurring problems, which are exactly the four modules of this portal:

| Problem in the business | What the portal does about it |
| --- | --- |
| Customer information (and who owes a follow-up call) lives in personal phones and notebooks. | A shared **Customer CRM** with status, type, follow-up date, and a timestamped follow-up note history. |
| Nobody agrees on how much stock is actually on the shelf. | A single **product master** with a `current_stock` figure that only ever changes through a logged movement. |
| Stock changes are untraceable — "who took 50 units out and why?" | An append-only **stock movement log**: product, quantity, IN/OUT, reason, who did it, when. |
| A dispatch is written on paper, and the stock is deducted (or forgotten) later. | A **sales challan** flow where confirming the challan deducts stock *atomically*, refuses to go negative, and freezes a snapshot of what was actually sold at that price. |

The single most important guarantee of the system:

> **Recorded stock and the movement log can never disagree, and stock can never go negative.**

---

## 3. Who uses it

Four employee roles, taken directly from the case study.

| Role | Who they are | What they come to the portal to do |
| --- | --- | --- |
| **Admin** | Owner / operations manager | Everything. Oversees all modules, manages master data, resolves exceptions. |
| **Sales** | Field & counter sales staff | Add and update customers, log follow-ups, raise sales challans, check whether stock is available. |
| **Warehouse** | Storekeeper / dispatch | Maintain the product master, record stock received (IN) and issued (OUT), watch low-stock items, confirm challans on dispatch. |
| **Accounts** | Billing / accounts staff | Read-only visibility over customers, products, stock movements and challans for reconciliation and billing. |

The complete, enforceable permission matrix is defined in
[ARCHITECTURE.md § Role-based access strategy](./ARCHITECTURE.md#8-role-based-access-strategy)
and will be implemented and re-documented in `docs/AUTHENTICATION.md` in Phase 2.

---

## 4. Main modules

1. **Authentication & Roles** — email + password login, JWT session, four roles, backend-enforced authorization.
2. **Customer CRM** — customer master (name, mobile, email, business name, optional GST, type, address, status, follow-up date, notes), search, filter, pagination, detail page, follow-up note history.
3. **Products & Inventory** — product master (name, SKU, category, unit price, current stock, minimum stock alert quantity, location/warehouse), search, filter, low-stock indicator.
4. **Stock Movements** — append-only ledger of every stock change: product, quantity, IN/OUT, reason, created by, timestamp, and a link back to the challan when the movement was system-generated.
5. **Sales Challans** — customer selection, multiple product lines with quantities, auto-generated challan number, Draft → Confirmed / Cancelled lifecycle, stock deduction on confirm, product snapshot per line.
6. **Dashboard** — operational counters computed from live data (customers, low-stock products, draft/confirmed challans, recent activity).

---

## 5. Main workflows

### 5.1 Customer workflow

```
Sales creates a customer as status = LEAD
        │
        ├── logs a follow-up note (and optionally sets the next follow-up date)
        │
        └── when the lead converts → status = ACTIVE  →  customer can be used on a challan
                                  → if it goes cold  →  status = INACTIVE
```

### 5.2 Inventory workflow

```
Warehouse creates a product (opening stock = 0)
        │
        ├── goods received      → stock movement IN  (reason: "Purchase GRN #...")   → current_stock ↑
        ├── damage / correction → stock movement OUT (reason: "Damaged in transit")  → current_stock ↓
        │                                                                   (rejected if it would go below 0)
        └── current_stock <= min_stock_alert_quantity → product is flagged LOW STOCK in the UI
```

### 5.3 Sales challan workflow (the core flow)

```
Sales picks a customer
        │
        ├── adds N product lines, each with a quantity
        │
        ├── saves as DRAFT ──────────────► stock is NOT touched. The draft is freely editable.
        │                                   (a draft is a proposal, not a commitment)
        │
        ├── CONFIRM ─────────────────────► inside ONE database transaction:
        │        │                           1. lock every product row in the challan
        │        │                           2. verify available >= requested for ALL lines
        │        │                           3. if ANY line fails  → abort everything, 409 error
        │        │                              "Insufficient stock for <product>. Available: 5, Requested: 8."
        │        │                           4. otherwise decrement current_stock on each product
        │        │                           5. write one OUT stock movement per line, referencing the challan
        │        │                           6. mark challan CONFIRMED, stamp confirmed_by / confirmed_at
        │        │
        │        └── the challan becomes immutable; its line items keep the product
        │            name, SKU and unit price **as they were at the moment of sale**
        │
        └── CANCEL (only while DRAFT) ───► status = CANCELLED, stock still untouched.
```

Because a confirmed challan stores a **snapshot** of each product, renaming a product or changing
its price next month does not silently rewrite last month's dispatch records.

---

## 6. Technology stack

| Layer | Choice | Why |
| --- | --- | --- |
| Backend runtime | **Node.js 20+** | Required by the case study. |
| Backend language | **TypeScript** (strict) | Required. Types across controller → service → repository catch integration mistakes at compile time. |
| Backend framework | **Express.js 5** | Required (Express or NestJS). Express keeps the layering explicit and readable for a reviewer; NestJS would add framework concepts that this scope does not need. |
| Database | **PostgreSQL 16** | Required. Relational integrity, `CHECK` constraints and real transactions are exactly what the stock rules need. |
| DB driver | **`pg` (node-postgres)** with hand-written parameterized SQL | Explicit `BEGIN / SELECT … FOR UPDATE / COMMIT` control, which the challan-confirm logic depends on. An ORM would hide the very thing being assessed. |
| Migrations | Numbered `.sql` files + a small Node runner | Transparent, reviewable, no extra tooling to learn. |
| Validation | **Zod** | One schema validates body/query/params and produces the TypeScript type — no duplicated shape definitions. |
| Auth | **JWT (HS256)** + **bcrypt** password hashing | Explicitly permitted by the case study. |
| Frontend | **React 18 + TypeScript + Vite** | Required. Vite for fast builds and a trivial static deploy. |
| Routing | **react-router-dom** | Standard. |
| HTTP client | **axios** with one shared instance + interceptors | Single place for the auth header and 401 handling. |
| Styling | **Plain CSS with CSS custom properties** (design tokens) + component-scoped stylesheets | The case study asks for HTML/CSS skill. No UI kit, so the admin styling is genuinely ours and stays responsive and consistent. |
| Deployment | Frontend → **Vercel**, Backend → **Render**, Database → **Neon** (all free tiers) | Simplest reliable free combination. AWS is a bonus only, and the case study states no money should be spent. |

**Deliberately excluded** (and why): MongoDB, GraphQL, NestJS, Redis, message queues, microservices,
Docker-for-its-own-sake, Kubernetes, state-management libraries, and UI component kits. None of them
solve a problem this assignment actually has.

---

## 7. Architecture overview

```
┌───────────────────────────┐        HTTPS / JSON          ┌──────────────────────────────┐
│  React SPA (Vercel)       │  ─────────────────────────►  │  Express REST API (Render)   │
│  • pages + components     │   Authorization: Bearer JWT  │  routes → controllers →      │
│  • one axios API layer    │  ◄─────────────────────────  │  services → repositories     │
│  • role-aware navigation  │        JSON envelope         │  Zod validation, RBAC,       │
└───────────────────────────┘                              │  central error handler       │
                                                           └───────────────┬──────────────┘
                                                                           │ pooled SQL
                                                                           │ (parameterized)
                                                                ┌──────────▼──────────┐
                                                                │ PostgreSQL (Neon)   │
                                                                │ constraints + TX    │
                                                                └─────────────────────┘
```

Three tiers, one repository. Details in [ARCHITECTURE.md](./ARCHITECTURE.md).

---

## 8. Business assumptions

These are decisions the case study leaves open. They are implemented as stated and can be revisited.

| # | Assumption |
| --- | --- |
| A1 | **Single company, single tenant.** No multi-company or multi-branch separation. |
| A2 | **Single stock figure per product.** `location` is a descriptive label ("Rack A-12", "Main Warehouse"), not a separate stock bucket. Per-location stock would need a `product_stock_by_location` table and is out of MVP scope. |
| A3 | **Quantities are whole units** (integers). No decimal/fractional units, no unit-of-measure conversion. |
| A4 | **Prices are in a single currency (INR)** stored as `NUMERIC(12,2)`. No multi-currency, no FX. |
| A5 | **No tax computation.** GST number is stored as a customer attribute only; the portal does not calculate GST, and challans carry no tax lines. |
| A6 | **A customer's mobile number is unique** and is the practical business identifier. Email is required but not unique. |
| A7 | **Users are seeded, not self-registered.** There is no public sign-up; Admin-managed user CRUD is out of MVP scope. |
| A8 | **A challan is only editable while it is a Draft.** Confirmed and Cancelled challans are immutable. |
| A9 | **A confirmed challan cannot be cancelled in the MVP.** Reversing a confirmed dispatch requires a stock-return flow (IN movements) that is deliberately out of scope; it is listed under future enhancements. |
| A10 | **Deleting a customer is a soft delete** (`deleted_at`). Hard deletion would orphan historical challans. |
| A11 | **Products are deactivated, not deleted** (`is_active = false`). Inactive products cannot be added to new challans but remain visible on historical ones. |
| A12 | **Challan numbers are globally sequential**, formatted `CH-YYYY-NNNNNN`, drawn from a PostgreSQL sequence. The counter does not reset each year; the year in the prefix is the year of issue. |
| A13 | **Stock can only be changed through a logged movement.** There is no "edit current stock" field on the product form — editing a product cannot silently change stock. |
| A14 | **A stock movement, once written, is never edited or deleted.** Corrections are new, opposite movements with a reason. |
| A15 | **Purchase orders and invoices are out of MVP scope.** The case study's *Core Modules Required* section lists only auth, CRM, products/inventory and sales challans; the business-context sentence that mentions POs and invoices is treated as background, not as a requirement. |
| A16 | **Sessions are stateless JWTs with a fixed expiry (8h) and no refresh token.** Logging out clears the token client-side; there is no server-side token revocation list. |
| A17 | **All timestamps are stored as `TIMESTAMPTZ` in UTC** and rendered in the browser's local timezone. `follow_up_date` is a plain `DATE` because it is a calendar day, not an instant. |

---

## 9. MVP scope (what Phases 1–10 will actually deliver)

**In scope — mandatory:**

- [ ] JWT login, four roles, backend-enforced role authorization on every protected route
- [ ] Customer CRM: create, edit, search, filter, paginate, detail page, follow-up note history
- [ ] Product master: create, edit, search, filter, paginate, detail page, low-stock indicator
- [ ] Stock movements: manual IN / OUT with mandatory reason, full audit log per product
- [ ] Negative stock prevention at the database level *and* the service level
- [ ] Sales challans: multi-line creation, auto challan number, Draft / Confirmed / Cancelled
- [ ] Transactional stock deduction on confirm, all-or-nothing, with a clear insufficient-stock error
- [ ] Product snapshot (name, SKU, unit price, quantity) stored on every challan line
- [ ] Dashboard with counters derived from real queries
- [ ] Responsive admin-style React UI with loading / empty / error / success states
- [ ] Consistent REST envelope, correct HTTP status codes, no stack traces leaked to clients
- [ ] Migrations + seed data + `.env.example`
- [ ] Full documentation set, Postman collection, deployment, test credentials for all four roles

**Explicitly out of scope for the MVP:** purchase orders, invoices & tax computation, payments /
outstanding balances, returns & credit notes, per-location stock, product images, reports &
analytics beyond the dashboard counters, email/SMS notifications, user self-registration,
password reset, audit trail for non-stock entities, real-time updates.

---

## 10. Future enhancements

Ordered by how much a real distributor would actually want them:

1. **Invoice generation from a confirmed challan** + PDF export (case-study bonus).
2. **Stock return / credit note** flow, which then makes cancelling a confirmed challan safe.
3. **Purchase orders and goods-receipt notes**, so IN movements originate from a document instead of a free-text reason.
4. **Admin user management** (invite, deactivate, reset password) and a refresh-token session model.
5. **Per-warehouse stock buckets** with inter-warehouse transfers.
6. **Payments and outstanding balance** per customer, with an ageing view.
7. **Reporting**: sales by customer / product / period, stock valuation, follow-ups due today.
8. **Product images on S3**, Docker Compose for local parity, and GitHub Actions CI/CD (case-study bonuses).
9. **Full audit trail** on customers and products, matching the discipline already applied to stock.
