# Mini ERP + CRM Operations Portal

An internal operations portal for a wholesale / distribution company: customer CRM, product master,
inventory with a full stock-movement ledger, and sales challans with transactional stock deduction.

> **Status: Phase 5 — all core modules complete.**
> Working today: JWT login with four roles and role-based authorization, the customer CRM
> (search, filters, pagination, follow-up notes), the product/inventory module with an append-only
> stock ledger and low-stock alerting, and sales challans with Draft/Confirmed/Cancelled lifecycle,
> all-or-nothing transactional stock deduction and immutable product snapshots.
> Remaining: dashboard and UX polish (Phase 6), system testing (7), API docs & Postman (8),
> deployment (9), final submission README (10).

---

## Technology stack

**Backend** Node.js 20+ · TypeScript (strict) · Express 5 · PostgreSQL via `pg` with hand-written SQL · Zod · JWT · bcrypt  
**Frontend** React 18 · TypeScript · Vite 6 · React Router · axios · plain CSS with design tokens  
**Database** PostgreSQL 16/17  
**Deployment** Vercel (frontend) · Render (backend) · Neon (PostgreSQL) — all free tiers  

---

## Repository structure

```text
mini-erp-crm/
├── backend/
│   ├── scripts/copy-assets.mjs      copies .sql migrations into dist/ after tsc
│   ├── src/
│   │   ├── config/                  env.ts (validated config), db.ts (pool + withTransaction)
│   │   ├── controllers/             HTTP layer — no business logic
│   │   ├── middleware/              errorHandler, notFound  (+ auth, validate from Phase 2)
│   │   ├── routes/                  route table, mounted under /api
│   │   ├── db/
│   │   │   ├── migrations/          numbered, forward-only .sql files
│   │   │   ├── migrate.ts           migration runner
│   │   │   └── seed.ts              idempotent development seed
│   │   ├── types/                   domain enums shared across layers
│   │   ├── utils/                   AppError, httpResponse, logger, password, asyncHandler
│   │   ├── app.ts                   express assembly
│   │   └── server.ts                entry point, graceful shutdown
│   ├── .env.example
│   ├── package.json
│   └── tsconfig.json
├── frontend/
│   ├── src/
│   │   ├── api/                     axios instance + one module per resource
│   │   ├── config/                  env.ts — the only reader of import.meta.env
│   │   ├── hooks/                   useApi (loading / error / data)
│   │   ├── pages/                   one folder per screen
│   │   ├── styles/                  tokens.css (design tokens), global.css
│   │   ├── types/                   API contract types
│   │   ├── App.tsx                  route table
│   │   └── main.tsx
│   ├── .env.example
│   ├── index.html
│   ├── package.json
│   └── vite.config.ts
├── docs/
├── postman/                         (Phase 8)
├── .env.example                     system-wide variable reference
├── .gitignore
└── README.md
```

---

## Local setup

### Prerequisites

- **Node.js 20 or newer** (`node --version`)
- **PostgreSQL 14 or newer** running locally, *or* a free hosted database
  ([Neon](https://neon.tech), Supabase, Render Postgres). Nothing in the project is
  installation-specific — it only needs a connection string.

### 1. Clone and install

```bash
git clone https://github.com/<your-username>/Fundsroom_Assessment.git
cd Fundsroom_Assessment

cd backend  && npm install && cd ..
cd frontend && npm install && cd ..
```

### 2. Create the database

**Local PostgreSQL** — from a terminal that has `psql` on its PATH (on a default Windows install
that is `C:\Program Files\PostgreSQL\17\bin`; adjust for your install directory):

```bash
createdb -U postgres mini_erp_crm
# or, equivalently:
psql -U postgres -c "CREATE DATABASE mini_erp_crm;"
```

**Hosted (Neon / Supabase / Render)** — create a project in the provider's dashboard and copy the
connection string it gives you. No `createdb` step is needed.

### 3. Configure environment variables

```bash
cd backend  && cp .env.example .env
cd ../frontend && cp .env.example .env
```

Then edit `backend/.env`:

| Variable | What to put in it |
| --- | --- |
| `DATABASE_URL` | `postgresql://postgres:<your-password>@localhost:5432/mini_erp_crm`, or the connection string from your provider |
| `DATABASE_SSL` | `false` for a local install, `true` for any hosted provider |
| `JWT_SECRET` | A long random string. Generate one: `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` |
| `CORS_ORIGINS` | `http://localhost:5173` for local development |

`frontend/.env` normally needs no change for local development; it points at
`http://localhost:4000/api`.

Both `.env` files are git-ignored. Only the `.env.example` files are ever committed —
see [Environment variables](#environment-variables) below.

### 4. Create the tables and seed development data

```bash
cd backend
npm run db:setup     # = npm run migrate && npm run seed
```

`migrate` applies every pending file in `src/db/migrations/` inside a transaction and records it in
`schema_migrations`; re-running it is a no-op. `seed` inserts four users, seven customers and ten
products, and is idempotent — running it twice does not duplicate anything.

You can run the two steps separately (`npm run migrate`, `npm run seed`) if you prefer.

### 5. Start both applications

Two terminals:

```bash
# terminal 1
cd backend && npm run dev      # http://localhost:4000

# terminal 2
cd frontend && npm run dev     # http://localhost:5173
```

Open <http://localhost:5173>. The System Status screen should show **Operational**, with the
database connected. If it cannot reach the API it tells you exactly what to check.

You can also verify the API directly:

```bash
curl http://localhost:4000/api/health
```

---

## Development credentials

Created by `npm run seed`. These are **throwaway demo accounts for a development database**, not
secrets — the case study requires working test logins for every role. The passwords come from the
`SEED_*_PASSWORD` variables in `backend/.env`; the values below are the documented defaults used
when those variables are absent.

| Role | Email | Default password |
| --- | --- | --- |
| Admin | `admin@fundsroom.local` | `Admin@12345` |
| Sales | `sales@fundsroom.local` | `Sales@12345` |
| Warehouse | `warehouse@fundsroom.local` | `Warehouse@12345` |
| Accounts | `accounts@fundsroom.local` | `Accounts@12345` |

Passwords are bcrypt-hashed before they reach the database; no plaintext is ever stored. The seed
script refuses to run when `NODE_ENV=production` unless `ALLOW_PRODUCTION_SEED=true` is set
explicitly, so these defaults cannot be created on a production database by accident.

On the sign-in screen each account is available as a one-click chip, so you can switch roles without
retyping credentials.

---

## Available scripts

**Backend** (`cd backend`)

| Command | What it does |
| --- | --- |
| `npm run dev` | Start with hot reload (tsx watch) |
| `npm run build` | Compile TypeScript to `dist/` and copy the `.sql` migrations across |
| `npm start` | Run the compiled build (production) |
| `npm run typecheck` | Type-check without emitting |
| `npm run migrate` | Apply pending migrations |
| `npm run seed` | Insert development seed data |
| `npm run db:setup` | Migrate, then seed |

**Frontend** (`cd frontend`)

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server on port 5173 |
| `npm run build` | Type-check, then build to `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm run typecheck` | Type-check without emitting |

---

## Environment variables

Every variable is documented with safe placeholders in [.env.example](.env.example) (system-wide),
[backend/.env.example](backend/.env.example) and [frontend/.env.example](frontend/.env.example).

How they are managed:

- **Local** — real values live in `backend/.env` and `frontend/.env`, both git-ignored. The
  `.gitignore` ignores `.env` and `.env.*` and then re-includes `!.env.example`, so an example file
  is committed and a real one cannot be.
- **Backend loading** — `src/config/env.ts` is the only module that reads `process.env`. It
  validates everything with Zod at boot and **exits with a readable message** if a variable is
  missing or malformed, rather than failing later with an obscure error.
- **Frontend loading** — `src/config/env.ts` is the only module that reads `import.meta.env`. Vite
  inlines `VITE_*` variables into the built bundle, so they are public by definition and never hold
  a secret.
- **Production** — values are set in the hosting provider's dashboard (Render for the backend,
  Vercel for the frontend), never in a file. Full detail lands in `docs/DEPLOYMENT.md` in Phase 9.

---

## Documentation

| Document | What it covers |
| --- | --- |
| [docs/PROJECT_OVERVIEW.md](docs/PROJECT_OVERVIEW.md) | What the portal is, who uses it, the business problem, modules, workflows, assumptions, MVP scope, future work |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System / frontend / backend / database architecture, auth flow, request flow, error handling, role permission matrix |
| [docs/DATABASE_DESIGN.md](docs/DATABASE_DESIGN.md) | Every table, column, key, constraint and index, plus the reference DDL and the seed-data plan |
| [docs/API_PLAN.md](docs/API_PLAN.md) | All 26 planned REST endpoints, conventions, response envelope, error codes, validation rules |
| [docs/AUTHENTICATION.md](docs/AUTHENTICATION.md) | JWT design, login flow, password storage, **permission matrix**, security decisions and limitations, 21 test results |
| [docs/CRM_MODULE.md](docs/CRM_MODULE.md) | Customer workflow, data model, endpoints, validation, role access, frontend behaviour, 31 test results |
| [docs/INVENTORY_MODULE.md](docs/INVENTORY_MODULE.md) | Product master, the stock-only-moves-through-the-ledger rule, transaction & row-locking design, low-stock logic, 25 test results plus a concurrency proof |
| [docs/SALES_CHALLAN_MODULE.md](docs/SALES_CHALLAN_MODULE.md) | Challan lifecycle, draft vs confirmed, the two-pass transactional stock deduction, **product snapshot**, challan numbering, 41 test results plus a concurrency proof |

Documents added in later phases:
`SALES_CHALLAN_MODULE.md`, `FRONTEND_GUIDE.md`, `TESTING.md`, `API_DOCUMENTATION.md`, `DEPLOYMENT.md`.

---

## Build phases

| Phase | Scope | Status |
| --- | --- | --- |
| 0 | Analysis, architecture, database design, API plan | ✅ Complete |
| 1 | Backend + frontend scaffolding, migrations, seed data | ✅ Complete |
| 2 | Authentication and role-based access | ✅ Complete |
| 3 | Customer CRM module | ✅ Complete |
| 4 | Products, inventory and stock movements | ✅ Complete |
| 5 | Sales challans with transactional stock deduction | ✅ Complete |
| 6 | Dashboard and complete frontend UX | ⬜ |
| 7 | Testing, validation and bug fixing | ⬜ |
| 8 | API documentation and Postman collection | ⬜ |
| 9 | Deployment | ⬜ |
| 10 | Final documentation and submission preparation | ⬜ |
