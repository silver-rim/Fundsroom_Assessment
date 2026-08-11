# Submission — Mini ERP + CRM Operations Portal

Full Stack Developer case study · 48 hours

This document exists for one reason: to let a reviewer find any requirement quickly, and to be
straight about what is and is not there. Everything claimed below is checkable in the repository.

---

## 1. Links

| | |
| --- | --- |
| **Repository** | `https://github.com/<your-username>/Fundsroom_Assessment` |
| **Live app** | *fill in after deploying — see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)* |
| **Live API** | *fill in — health check at `/api/health`* |

> The deployment configuration is committed and both production builds are verified
> (`render.yaml`, `frontend/vercel.json`, [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)). The hosting
> accounts belong to the submitter, so the URLs are filled in at deploy time.
>
> **On a free tier the first request can take up to a minute** while the API instance wakes up.
> That is Render's free plan spinning down an idle service, not the application.

### Test credentials

| Role | Email | Password |
| --- | --- | --- |
| Admin | `admin@fundsroom.local` | `Admin@12345` |
| Sales | `sales@fundsroom.local` | `Sales@12345` |
| Warehouse | `warehouse@fundsroom.local` | `Warehouse@12345` |
| Accounts | `accounts@fundsroom.local` | `Accounts@12345` |

Each is a one-click chip on the sign-in screen, so switching roles takes a second. These are the
documented development defaults; a deployed instance should use its own `SEED_*_PASSWORD` values.

---

## 2. Evaluating it in ten minutes

If you only have a few minutes, this path exercises the parts that were hard.

1. **Sign in as Admin.** The dashboard counters are all live aggregate queries — no cached or
   denormalised numbers anywhere.
2. **Products → find a low-stock item.** The badge is computed in SQL as
   `current_stock <= min_stock_alert`, never stored, so it cannot disagree with the number beside it.
3. **Challans → New.** Pick a customer, add two products, save as a draft. Note that the form never
   sends a price — names and prices are read server-side from the product table, so a caller cannot
   dictate what something sold for.
4. **Confirm the challan.** Then open the product you sold: stock has fallen by exactly that
   quantity, and the stock ledger has a new `OUT` row whose reason names the challan.
5. **Try to confirm it again** → 409, with an explanation. Confirmation is not idempotent and says so
   rather than silently double-deducting.
6. **Raise a challan for more stock than exists and confirm it** → 409 `INSUFFICIENT_STOCK` listing
   *every* short line, not just the first. Nothing was written: the challan is still a draft and no
   stock moved.
7. **Sign in as Warehouse.** The Customers screen is read-only and the "New customer" route is
   blocked — enforced by the API, not just hidden in the UI. Confirm that with a raw request:

   ```bash
   curl -X POST http://localhost:4000/api/customers -H "Authorization: Bearer <warehouse token>" \
        -H 'Content-Type: application/json' -d '{}'
   # 403 FORBIDDEN — "Required role: ADMIN or SALES."
   ```

8. **Refresh the page on a detail screen.** The session rehydrates from the token via `/auth/me`.

Prefer the API directly? Import [`postman/`](postman/) and run the **Workflow (end-to-end)** folder —
the same story in eight requests, with assertions.

---

## 3. Requirements → where they are

### Core modules

| Requirement | Where | Notes |
| --- | --- | --- |
| **Authentication** — email + password, JWT | [`services/auth.service.ts`](backend/src/services/auth.service.ts), [`utils/jwt.ts`](backend/src/utils/jwt.ts) | HS256, 8h, bcrypt-hashed passwords. Algorithm is pinned — a token never chooses its own |
| **Four roles, backend-enforced** | [`config/permissions.ts`](backend/src/config/permissions.ts), [`middleware/authorize.ts`](backend/src/middleware/authorize.ts) | The matrix is executable code the routes reference, not prose — and **18 protected routes × 4 roles = 72 generated test cases** check the documented matrix against the running code, plus a 73rd asserting all 18 are 401 without a token |
| **Customer CRM** — CRUD, search, filter, pagination, detail | [`customer.*`](backend/src/services/customer.service.ts), [`pages/Customers/`](frontend/src/pages/Customers/) | Soft delete; mobile is the unique business identifier |
| **Follow-up history** | `POST/GET /customers/:id/follow-ups` | Adding a note with a next date moves the customer's follow-up date **in the same transaction**, so the list and the history cannot disagree |
| **Product master** — CRUD, search, filter, low-stock | [`product.service.ts`](backend/src/services/product.service.ts), [`pages/Products/`](frontend/src/pages/Products/) | `isLowStock` computed in SQL; products are deactivated, never deleted |
| **Stock movements** — IN/OUT, reason, audit log | [`stockMovement.service.ts`](backend/src/services/stockMovement.service.ts) | Append-only. No update, no delete: a mistake is corrected by an opposite movement |
| **Negative stock prevented** | Service check + `CHECK (current_stock >= 0)` | Both layers, deliberately. The constraint is the backstop if the service logic is ever wrong |
| **Sales challans** — multi-line, auto number, lifecycle | [`challan.service.ts`](backend/src/services/challan.service.ts) | `CH-YYYY-NNNNNN` from a sequence; Draft → Confirmed / Cancelled |
| **Transactional stock deduction** | `confirmChallan()` | One transaction, all-or-nothing. See §4 |
| **Product snapshot per line** | `sales_challan_items.product_name / product_sku / unit_price` | A rename or reprice cannot rewrite a dispatched document |
| **Dashboard** | [`dashboard.repository.ts`](backend/src/repositories/dashboard.repository.ts) | Every counter is a real aggregate. Field-by-field definitions in [FRONTEND_GUIDE.md](docs/FRONTEND_GUIDE.md) §2.2 |

### Technical requirements

| Requirement | Where |
| --- | --- |
| Node.js + Express + PostgreSQL | `backend/` — Express 5, `pg` with hand-written SQL, no ORM ([why](docs/ARCHITECTURE.md)) |
| React frontend | `frontend/` — React 18, TypeScript, Vite, React Router; plain CSS with design tokens |
| Input validation | Zod schemas in [`validators/`](backend/src/validators/); the inferred type **is** the DTO, so validation and typing cannot drift |
| Consistent API responses | One envelope everywhere — [`utils/httpResponse.ts`](backend/src/utils/httpResponse.ts) |
| Proper error handling | One central handler, [`middleware/errorHandler.ts`](backend/src/middleware/errorHandler.ts); 17 error codes; no stack traces in production |
| Correct HTTP status codes | Full table in [API_DOCUMENTATION.md](docs/API_DOCUMENTATION.md) §10 — including the deliberate 400-vs-422 split |
| Migrations | Numbered, forward-only `.sql` + a runner that applies each in its own transaction |
| Seed data | Idempotent; refuses to run against production without an explicit opt-in |
| Environment config | `.env.example` at three levels; validated with Zod at boot, exits with a readable message |

### Deliverables

| Deliverable | Status |
| --- | --- |
| GitHub repository | ✅ Committed in ten reviewable phases |
| README with setup instructions | ✅ [README.md](README.md) — clone to running app in five steps |
| API documentation | ✅ [docs/API_DOCUMENTATION.md](docs/API_DOCUMENTATION.md) — all 30 routes, every example captured from the running API |
| Postman collection | ✅ [postman/](postman/) — 56 requests, 144 assertions, passing |
| Deployment | ✅ Configured and documented; running it needs the submitter's accounts |
| Test credentials for all roles | ✅ §1 above |
| Database schema documentation | ✅ [docs/DATABASE_DESIGN.md](docs/DATABASE_DESIGN.md) |

---

## 4. The part worth reviewing

Most of this project is ordinary CRUD, honestly built. One operation is not, and it is where the
engineering attention went: **confirming a sales challan.**

Confirming means "these goods have left the building", so it must deduct stock for every line, write
a ledger entry for each, freeze what was sold at what price, and flip the document's status —
without any partial outcome ever being visible or persisted.

[`confirmChallan()`](backend/src/services/challan.service.ts) does this in one transaction:

1. Lock the challan row (`FOR UPDATE`) → 404 if gone, 409 if it is not a `DRAFT`.
2. Lock every referenced product **ordered by product id**. Two concurrent confirmations therefore
   take the same rows in the same sequence and cannot deadlock by grabbing them in opposite orders.
3. Check **every** line before changing anything, collecting all shortfalls — so the user is told
   about every problem at once instead of discovering them one attempt at a time.
4. Any shortfall → `ROLLBACK`. No stock moved, no ledger rows, the challan is still a draft.
5. Otherwise decrement, insert one `OUT` movement per line referencing the challan, refresh each
   line's snapshot from the locked row, recompute totals, mark confirmed, `COMMIT`.

`CHECK (current_stock >= 0)` sits behind all of it: if the service logic were ever wrong, the
transaction aborts rather than persisting negative stock.

**This is tested, not asserted.** The suite includes three concurrency proofs that run real parallel
transactions against a real database — including two clients confirming challans for the same
product at the same time, where exactly one succeeds and stock never goes negative. See
[docs/TESTING.md](docs/TESTING.md) §3.

The same instinct shows up in smaller places: `currentStock` is rejected on the product update route
rather than silently stripped, because a caller who thinks they changed stock and did not is worse
off than one who gets an error explaining the rule.

---

## 5. Decisions I made, and why

The case study leaves things open. These were chosen deliberately and are documented in full as
assumptions A1–A17 in [PROJECT_OVERVIEW.md](docs/PROJECT_OVERVIEW.md) §8. The four that most affect
what you will see:

| Decision | Reasoning |
| --- | --- |
| **A confirmed challan cannot be cancelled** | The goods have left. Reversing it means putting stock back, which is a returns flow with its own IN movements and paperwork. Silently adding stock back would let anyone inflate inventory by confirming and cancelling in a loop |
| **Stock changes only through a logged movement** | There is no "edit stock" field anywhere. Every unit in `current_stock` is explained by a row in the ledger, including a product's opening stock |
| **Soft delete for customers, deactivation for products** | Hard deletion would orphan historical challans. A document raised last year must still read correctly |
| **No purchase orders or invoices** | The case study's *Core Modules Required* section lists four modules; the business-context sentence mentioning POs and invoices is background, not a requirement. Building them badly would have cost the depth in the four that were asked for |

---

## 6. What is not here

Stated plainly rather than left for you to discover:

- **No rate limiting.** An internal tool behind authentication, and out of the case study's scope —
  but it is the first thing I would add before any public exposure.
- **No refresh tokens.** A JWT is valid for its full 8 hours, so deactivating a user takes effect at
  their next login. This is the documented cost of a stateless API, and the first thing I would
  revisit.
- **No browser-level end-to-end tests.** The 255 automated tests cover the API exhaustively and the
  frontend's pure logic; the React components themselves were verified by hand and through the
  Postman workflow. A Playwright suite is the honest next step, and it is called out in
  [TESTING.md](docs/TESTING.md) §6 rather than glossed over.
- **User administration is read-only.** `GET /api/users` lists staff; there is no create/update, per
  assumption A7.
- **No tax computation.** GST numbers are stored as customer attributes; challans carry no tax lines.

---

## 7. By the numbers

| | |
| --- | --- |
| API routes | 29 |
| Database tables | 7 (+ a migrations bookkeeping table) |
| Frontend screens | 16 page components across 10 areas |
| TypeScript | ~13,900 lines across backend and frontend |
| Automated tests | **255** — 237 backend integration tests against a real PostgreSQL database, 18 frontend unit tests |
| Postman | 56 requests, **144 assertions** |
| Documentation | 12 documents, ~5,100 lines |
| Defects found and fixed by the test phase | 5, each written up in [TESTING.md](docs/TESTING.md) §4 |

---

## 8. Where everything lives

| Document | Read it for |
| --- | --- |
| [README.md](README.md) | Setup, scripts, environment variables — start here to run it |
| [docs/PROJECT_OVERVIEW.md](docs/PROJECT_OVERVIEW.md) | What the portal is, who uses it, the 17 business assumptions |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Layering, why no ORM, the error-handling contract |
| [docs/DATABASE_DESIGN.md](docs/DATABASE_DESIGN.md) | Schema, constraints, indexes, and the reasoning behind each |
| [docs/API_DOCUMENTATION.md](docs/API_DOCUMENTATION.md) | The implemented API, with real captured examples |
| [docs/AUTHENTICATION.md](docs/AUTHENTICATION.md) | JWT design and the permission matrix |
| [docs/CRM_MODULE.md](docs/CRM_MODULE.md) · [INVENTORY_MODULE.md](docs/INVENTORY_MODULE.md) · [SALES_CHALLAN_MODULE.md](docs/SALES_CHALLAN_MODULE.md) | One per business module, with test results |
| [docs/FRONTEND_GUIDE.md](docs/FRONTEND_GUIDE.md) | UI conventions and what every dashboard counter means |
| [docs/TESTING.md](docs/TESTING.md) | How to run the suites, the concurrency proofs, the five defects |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Neon → Render → Vercel, and the traps |
| [postman/README.md](postman/README.md) | The collection, folder by folder |

---

## 9. Running it locally

```bash
cd backend  && npm install && cp .env.example .env   # then set DATABASE_URL and JWT_SECRET
npm run db:setup && npm run dev                       # → http://localhost:4000

cd ../frontend && npm install && cp .env.example .env
npm run dev                                           # → http://localhost:5173
```

Full instructions, including the database, are in [README.md](README.md#local-setup). Verify with:

```bash
cd backend && npm test        # 231
cd frontend && npm test       #  18
```
