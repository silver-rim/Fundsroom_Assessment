# Architecture — Mini ERP + CRM Operations Portal

> Phase 0 deliverable. Blueprint for the implementation that begins in Phase 1.
> Companion documents: [PROJECT_OVERVIEW.md](./PROJECT_OVERVIEW.md) · [DATABASE_DESIGN.md](./DATABASE_DESIGN.md) · [API_PLAN.md](./API_PLAN.md)

---

## 1. High-level architecture

A conventional, boring, three-tier web application. Boring is the point: a reviewer should be able
to trace any feature from a button click to a SQL statement in under a minute.

```
   BROWSER                          APPLICATION                         DATA
┌──────────────┐              ┌───────────────────────┐          ┌──────────────────┐
│  React SPA   │  HTTPS/JSON  │  Express REST API     │   TCP    │  PostgreSQL 16   │
│  (Vercel)    │─────────────►│  (Render)             │─────────►│  (Neon)          │
│              │◄─────────────│                       │◄─────────│                  │
│ JWT in       │  JSON        │  stateless, JWT-      │  pooled  │ constraints are  │
│ localStorage │  envelope    │  authenticated        │  conns   │ the last defence │
└──────────────┘              └───────────────────────┘          └──────────────────┘
```

**Why a single repository with `backend/` and `frontend/` side by side:** one clone, one README,
one issue tracker, atomic commits that change an API and its caller together. The two apps are
still independently buildable and independently deployable — there is no shared build step and no
monorepo tooling.

```
mini-erp-crm/  (repository root)
├── backend/          Express + TypeScript API
├── frontend/         React + TypeScript SPA
├── docs/             all documentation
├── postman/          Postman collection + the script that generates it
├── render.yaml       Render Blueprint for the API service (Phase 9)
├── .env.example      documented environment variables (no secrets)
├── .gitignore
└── README.md
```

**Deployment topology and why:**

| Piece | Platform | Reason |
| --- | --- | --- |
| Frontend | Vercel | Static build, free, instant rollbacks, env var for the API URL at build time. |
| Backend | Render Web Service | Free tier runs a long-lived Node process (needed for a connection pool), builds straight from GitHub. |
| Database | Neon Postgres | Free managed Postgres, real connection string, works from Render and from a laptop. |

The backend never serves the frontend's static files: keeping them separate makes CORS explicit
(and therefore reviewable) and lets either side be redeployed alone.

---

## 2. Frontend architecture

React 18 + TypeScript, built by Vite. A single-page app with client-side routing.

```
frontend/src/
├── api/                 axios instance + one module per resource (the ONLY place fetch/axios appears)
│   ├── client.ts        base URL, Bearer interceptor, 401 handling, error normalisation
│   ├── auth.api.ts      customers.api.ts, products.api.ts, stock.api.ts, challans.api.ts, dashboard.api.ts
├── components/          reusable, presentational: Button, Input, Select, Table, Badge, Modal,
│                        Pagination, SearchBar, Spinner, EmptyState, ErrorState, Toast, StatCard
├── layouts/             AppLayout (sidebar + topbar + <Outlet/>), AuthLayout (login)
├── pages/               one folder per module: Login, Dashboard, Customers, Products,
│                        StockMovements, Challans — each with List / Detail / Form screens
├── context/             AuthContext (user, token, login, logout, hasRole)
├── hooks/               useAuth, useDebounce, usePagination, useApi (loading/error/data triad)
├── routes/              route table, ProtectedRoute, RoleRoute
├── types/               shared TypeScript types mirroring the API contracts
├── styles/              tokens.css (colours, spacing, radii, shadows), global.css, utilities
├── utils/               formatters (date, currency), constants (enum labels, role labels)
├── App.tsx
└── main.tsx
```

**Rules the frontend follows:**

- **No raw HTTP outside `src/api/`.** Components call typed functions such as
  `listCustomers({ page, search })`. Swapping the base URL or the auth scheme touches one file.
- **Every async screen renders four states** — loading, empty, error, success. The `useApi` hook
  makes forgetting one awkward.
- **Server state is fetched per screen, not mirrored into a global store.** The only global state is
  the authenticated user (`AuthContext`). Redux/Zustand would be extra machinery for a problem this
  app does not have.
- **Validation is duplicated deliberately.** The client validates for fast feedback; the server
  validates because the client cannot be trusted. Client rules mirror the Zod schemas by hand.
- **Navigation is role-aware.** A Warehouse user is not shown a "New Challan" button — but the
  button being hidden is a courtesy, not a security control. The server is the security control.
- **Styling is plain CSS with design tokens** in `styles/tokens.css` (CSS custom properties for the
  palette, spacing scale, radii, and shadows), plus a component-scoped `.module.css` per component.
  Responsive behaviour comes from CSS Grid/Flexbox and a small number of breakpoints; on narrow
  screens the sidebar collapses to a drawer and wide data tables scroll horizontally inside their
  own container.

---

## 3. Backend architecture

Express 5 + TypeScript (`strict: true`), organised as strict layers. **Each layer may only call the
layer below it.**

```
HTTP request
    │
    ▼
[ route ]          declares method + path, and composes middleware:
    │                 authenticate → authorize(...roles) → validate(schema) → controller
    ▼
[ controller ]     HTTP-only. Reads req.validated / req.user, calls ONE service method,
    │              chooses the status code, sends the response envelope. No business logic,
    │              no SQL, no try/catch (async errors are forwarded to the error handler).
    ▼
[ service ]        ALL business rules live here: stock arithmetic, status transitions,
    │              challan numbering, snapshot construction, transaction boundaries.
    │              Throws typed AppError subclasses. Knows nothing about req/res.
    ▼
[ repository ]     ALL SQL lives here. Parameterized queries only. Accepts an optional
    │              PoolClient so a service can run several repository calls in one transaction.
    ▼
[ db pool ]        pg.Pool, configured from DATABASE_URL
```

```
backend/src/
├── config/          env.ts (Zod-validated environment), db.ts (pool + withTransaction), constants.ts
├── middleware/      authenticate.ts, authorize.ts, validate.ts, errorHandler.ts,
│                    notFound.ts, requestLogger.ts
├── routes/          index.ts + auth.routes.ts, customer.routes.ts, product.routes.ts,
│                    stock.routes.ts, challan.routes.ts, dashboard.routes.ts
├── controllers/     one per resource
├── services/        one per resource — the heart of the application
├── repositories/    one per table/aggregate
├── validators/      Zod schemas; the inferred types are the DTOs
├── types/           domain types, enums, Express request augmentation
├── utils/           AppError.ts, httpResponse.ts, password.ts, jwt.ts, pagination.ts, asyncHandler.ts
├── db/
│   ├── migrations/  001_init.sql, 002_… (numbered, forward-only)
│   ├── migrate.ts   applies pending migrations, records them in schema_migrations
│   └── seed.ts      idempotent development seed data
├── app.ts           express app assembly (helmet, cors, json, routes, error handler)
└── server.ts        reads config, verifies DB connectivity, listens
```

**Why no ORM.** The one genuinely hard requirement in this assignment — deduct stock for N products
and write N ledger rows atomically, with row locks, without ever going negative — is a transaction
and locking problem. Hand-written SQL in a repository layer makes that logic *visible*. An ORM would
bury it behind lazy loading and implicit transactions. The cost is writing SQL by hand; at seven
tables that cost is small, and every query is parameterized so injection is not a concern.

**Cross-cutting concerns, each in exactly one place:**

| Concern | Where |
| --- | --- |
| Environment configuration | `config/env.ts` — parsed and validated by Zod at boot; the process **exits** if a required variable is missing or malformed. Nothing else reads `process.env`. |
| Database access | `config/db.ts` — one `Pool`, plus `withTransaction(fn)` which acquires a client, `BEGIN`s, runs `fn(client)`, `COMMIT`s, and `ROLLBACK`s on any throw. |
| Authentication | `middleware/authenticate.ts` |
| Authorization | `middleware/authorize.ts` |
| Input validation | `middleware/validate.ts` + `validators/*` |
| Error translation | `middleware/errorHandler.ts` — the single place that turns a thrown error into an HTTP response. |
| Security headers / CORS / body limits | `app.ts` (helmet, cors allow-list, `express.json({ limit: '100kb' })`) |

---

## 4. Database architecture

PostgreSQL 16. Full table-by-table design is in [DATABASE_DESIGN.md](./DATABASE_DESIGN.md); the
architectural principles are:

1. **The database is the last line of defence, not a dumb store.** `NOT NULL`, `CHECK`, `UNIQUE` and
   foreign keys encode the invariants. `products.current_stock >= 0` is a `CHECK` constraint, so even
   a bug in the service layer cannot persist negative stock — the transaction fails instead.
2. **Enumerations are `TEXT` + `CHECK (value IN (...))`, not native `ENUM` types.** Adding a value to
   a native enum requires `ALTER TYPE` and cannot run inside every migration context; a `CHECK` is a
   one-line change, reads plainly in `psql`, and maps directly to a Zod enum in the application.
3. **Money is `NUMERIC(12,2)`, never floating point.** Quantities are `INTEGER` (assumption A3).
4. **Every table carries `created_at`; every mutable table also carries `updated_at`**, both
   `TIMESTAMPTZ NOT NULL DEFAULT now()`. `updated_at` is maintained by a shared trigger function so
   no query can forget it.
5. **History is preserved, not overwritten.** Stock movements are append-only. Challan items store a
   product snapshot. Customers are soft-deleted; products are deactivated.
6. **Referential integrity is explicit.** `ON DELETE CASCADE` only where a child genuinely cannot
   exist alone (challan items, follow-up notes). Everywhere else `ON DELETE RESTRICT`, so history
   cannot be silently destroyed.
7. **Schema changes are forward-only numbered SQL migrations**, applied by `db/migrate.ts` and
   recorded in a `schema_migrations` table. Each migration runs inside its own transaction.

---

## 5. Authentication flow

Stateless JWT. No server-side session store, which is what makes the API horizontally scalable and
free-tier friendly.

```
1.  User submits email + password on /login
        │
2.  POST /api/auth/login   { email, password }
        │
3.  Zod validates the body                      → 422 if malformed
4.  Repository loads the user by lower(email)
5.  bcrypt.compare(password, user.password_hash)
        │   ✗ user missing OR password wrong OR user inactive
        │      → 401 { code: "INVALID_CREDENTIALS",
        │              message: "Invalid email or password." }
        │        (identical response in all three cases — no account enumeration)
        │   ✓
6.  jwt.sign({ sub: user.id, role: user.role }, JWT_SECRET,
             { expiresIn: JWT_EXPIRES_IN, issuer: 'mini-erp-crm' })     // HS256
        │
7.  200 { success: true, data: { token, user: { id, name, email, role } } }
        │      (password_hash is never selected into a response object)
        │
8.  Browser stores the token; AuthContext holds the decoded user
        │
9.  Every subsequent request: Authorization: Bearer <token>
        │
10. authenticate middleware: verify signature + expiry
        │   ✗ missing/invalid/expired → 401 UNAUTHENTICATED / TOKEN_EXPIRED
        │   ✓ → req.user = { id, role }
        │
11. axios response interceptor: any 401 → clear token, redirect to /login
```

**Password storage.** `bcrypt` with cost factor 10. Plaintext passwords never touch the database,
never appear in logs, and are stripped from any error output.

**Token contents.** Only `sub` (user id), `role`, plus standard claims. No email, no name — the
client already has those from the login response, and a smaller token leaks less if it is exposed.
The role is read from the token rather than re-queried per request; the trade-off (a role change
takes effect at the user's next login) is documented as a known limitation.

**Storage choice.** `localStorage`, which is vulnerable to XSS. `httpOnly` cookies would be stronger
but require CSRF protection and a same-site/cross-origin cookie setup between Vercel and Render that
is disproportionate for this assignment. This is recorded as a known limitation rather than hidden.

---

## 6. Request / response flow

A single request, end to end — `POST /api/challans/:id/confirm`:

```
React ChallanDetail page
   → confirmChallan(id)                        [api/challans.api.ts]
   → axios request interceptor attaches Bearer token
   ────────────────────────────────────────────────────────── HTTPS
   → Express: helmet → cors → json body parser → requestLogger
   → router match: POST /api/challans/:id/confirm
   → authenticate                 verifies JWT              (401 on failure)
   → authorize('ADMIN','SALES','WAREHOUSE')                 (403 on failure)
   → validate({ params: idParamSchema })                    (422 on failure)
   → ChallanController.confirm    reads req.validated.params.id + req.user.id
   → ChallanService.confirm(id, userId)
        └── withTransaction(async (client) => {
                 challanRepo.findByIdForUpdate(id, client)      → 404 if missing
                 assert status === 'DRAFT'                      → 409 INVALID_STATE
                 productRepo.lockByIds(productIds ORDER BY id, client)   // SELECT … FOR UPDATE
                 for each item: assert available >= requested   → 409 INSUFFICIENT_STOCK
                 productRepo.decrementStock(...)                // CHECK guards >= 0
                 stockMovementRepo.insertMany(OUT rows, client)
                 challanRepo.markConfirmed(id, userId, client)
             })                                                // COMMIT, or ROLLBACK on any throw
   → controller sends 200 { success: true, data: challan }
   ────────────────────────────────────────────────────────── HTTPS
   → axios response interceptor (pass-through on 2xx)
   → page shows a success toast and re-renders with the new status and stock figures
```

Any thrown error short-circuits to the central error handler (step 6 in §7) and the transaction is
rolled back before the response is written.

**Response envelope — every endpoint, without exception:**

```jsonc
// success (single resource)
{ "success": true, "data": { /* … */ } }

// success (collection)
{ "success": true,
  "data": [ /* … */ ],
  "pagination": { "page": 1, "limit": 20, "total": 137, "totalPages": 7 } }

// failure
{ "success": false,
  "error": {
    "code": "INSUFFICIENT_STOCK",
    "message": "Insufficient stock for Copper Wire 2.5mm. Available: 5, Requested: 8.",
    "details": [ { "field": "items[1].quantity", "message": "Requested 8, available 5" } ]
  } }
```

A predictable envelope means the frontend has exactly one error-reading function.

---

## 7. Error-handling strategy

**One error type hierarchy, one handler, no `try/catch` scattered through controllers.**

```ts
class AppError extends Error {
  constructor(readonly statusCode: number, readonly code: string,
              message: string, readonly details?: ErrorDetail[]) { … }
  readonly isOperational = true;
}

BadRequestError      400  BAD_REQUEST
UnauthenticatedError 401  UNAUTHENTICATED | INVALID_CREDENTIALS | TOKEN_EXPIRED
ForbiddenError       403  FORBIDDEN
NotFoundError        404  NOT_FOUND
ConflictError        409  CONFLICT | DUPLICATE_SKU | DUPLICATE_MOBILE | INVALID_STATE | INSUFFICIENT_STOCK
ValidationError      422  VALIDATION_ERROR
```

**Status code policy:**

| Code | Used for |
| --- | --- |
| 200 | Successful read or update |
| 201 | Resource created (`Location`-style id in the body) |
| 204 | Successful delete with no body |
| 400 | Malformed request the schema cannot even parse — bad JSON, non-numeric `:id`, unusable query params |
| 401 | No token, invalid token, expired token, wrong credentials |
| 403 | Authenticated but the role is not permitted |
| 404 | Resource does not exist (or is soft-deleted) |
| 409 | State/uniqueness conflict: duplicate SKU or mobile, illegal status transition, **insufficient stock** |
| 422 | Well-formed request that fails semantic validation (missing field, bad email, invalid enum, negative quantity) |
| 500 | Unexpected failure — logged in full server-side, generic message to the client |

**The handler's contract:**

1. `AppError` → its own status, code, message and details are returned as-is (these messages are
   written for users: *"Insufficient stock for Copper Wire 2.5mm. Available: 5, Requested: 8."*).
2. `ZodError` → 422, flattened into `details[] = { field, message }`.
3. Known PostgreSQL error codes are translated, never leaked:
   `23505` unique violation → 409, `23503` FK violation → 409, `23514` check violation → 422.
4. Anything else → 500 with the fixed message *"An unexpected error occurred."*
5. **Stack traces are logged server-side and never sent to a client.** In development the response
   additionally carries the stack; the switch is `NODE_ENV`, decided in one place.
6. `asyncHandler` wraps every async route handler so a rejected promise reaches this handler instead
   of hanging the request.
7. A `notFound` middleware after all routes returns a 404 in the same envelope, so even a typo'd URL
   produces a parseable error.

---

## 8. Role-based access strategy

Authorization is **enforced on the server, on every protected route**. The frontend hides what a role
cannot use; the backend refuses it.

`authorize(...allowedRoles)` runs after `authenticate`, compares `req.user.role`, and throws
`ForbiddenError` (403) on a mismatch. Where a rule is finer-grained than "this role may call this
endpoint", it lives in the service layer instead (for example: a Draft challan may only be edited by
its creator or an Admin).

### Permission matrix (implemented and re-verified in Phase 2)

Legend: **F** full · **R** read-only · **—** no access

| Capability | Admin | Sales | Warehouse | Accounts |
| --- | :---: | :---: | :---: | :---: |
| Log in, view own profile | F | F | F | F |
| Dashboard | F | F | F | F |
| **Customers** — list / search / view detail | F | F | R | R |
| **Customers** — create, edit | F | F | — | — |
| **Customers** — soft delete | F | — | — | — |
| **Follow-up notes** — view | F | F | — | R |
| **Follow-up notes** — add | F | F | — | — |
| **Products** — list / search / view detail | F | R | F | R |
| **Products** — create, edit, deactivate | F | — | F | — |
| **Stock movements** — view log | F | R | F | R |
| **Stock movements** — record manual IN / OUT | F | — | F | — |
| **Challans** — list / view detail | F | F | R | R |
| **Challans** — create / edit draft | F | F | — | — |
| **Challans** — confirm (deducts stock) | F | F | F | — |
| **Challans** — cancel a draft | F | F | — | — |

**Rationale for the non-obvious cells:**

- *Sales can read products and stock movements* — they must know what is available before promising
  a delivery, but they must never adjust a stock figure by hand.
- *Warehouse can confirm a challan* — confirmation is the moment goods physically leave, which is a
  warehouse action; but Warehouse cannot create or price a challan.
- *Warehouse cannot see customer contact details beyond the list/detail view* — they need to know who
  a dispatch is for, not to work the sales pipeline, so they get read-only and no follow-up access.
- *Accounts is read-only everywhere.* Their MVP job is reconciliation and visibility. They get no
  write path at all, which is the safest default; billing writes arrive with the invoice module.
- *Only Admin deletes.* Deletion — even a soft one — is the one irreversible-feeling action, so it is
  kept to a single role.

Nothing in this matrix grants a role blanket access, and no role except Admin can both create master
data and move stock.
