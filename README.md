# Mini ERP + CRM Operations Portal

An internal operations portal for a wholesale / distribution company: customer CRM, product master,
inventory with a full stock-movement ledger, and sales challans with transactional stock deduction.

> **Status: Phase 0 — Analysis & Architecture.**
> This phase contains documentation only; no application code has been written yet.
> The full README (features, setup, credentials, deployment, limitations) is produced in Phase 10.

---

## Documentation

| Document | What it covers |
| --- | --- |
| [docs/PROJECT_OVERVIEW.md](docs/PROJECT_OVERVIEW.md) | What the portal is, who uses it, the business problem, modules, workflows, assumptions, MVP scope, future work |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System / frontend / backend / database architecture, auth flow, request flow, error handling, **role permission matrix** |
| [docs/DATABASE_DESIGN.md](docs/DATABASE_DESIGN.md) | Every table, column, key, constraint and index, plus the reference DDL and the seed-data plan |
| [docs/API_PLAN.md](docs/API_PLAN.md) | All 26 planned REST endpoints, conventions, response envelope, error codes, validation rules |

Documents added in later phases: `AUTHENTICATION.md`, `CRM_MODULE.md`, `INVENTORY_MODULE.md`,
`SALES_CHALLAN_MODULE.md`, `FRONTEND_GUIDE.md`, `TESTING.md`, `API_DOCUMENTATION.md`, `DEPLOYMENT.md`.

---

## Technology stack

**Backend** Node.js · TypeScript · Express.js · PostgreSQL (`pg`, hand-written SQL) · Zod · JWT · bcrypt
**Frontend** React 18 · TypeScript · Vite · React Router · axios · plain CSS with design tokens
**Database** PostgreSQL 16
**Deployment** Vercel (frontend) · Render (backend) · Neon (PostgreSQL) — all free tiers

---

## Planned repository structure

```
mini-erp-crm/
├── backend/          Express + TypeScript API   (Phase 1)
│   └── src/{config,middleware,routes,controllers,services,repositories,validators,types,utils,db}
├── frontend/         React + TypeScript SPA     (Phase 1)
│   └── src/{api,components,layouts,pages,context,hooks,routes,types,styles,utils}
├── docs/             documentation              ← this phase
├── postman/          Postman collection         (Phase 8)
├── .env.example      every environment variable, documented, no secrets
├── .gitignore
└── README.md
```

---

## Environment variables

All variables are documented with safe placeholders in [.env.example](.env.example).
Real values live only in untracked `.env` files locally and in the hosting provider's
environment settings in production. `.env` is git-ignored; `.env.example` is the only env file
that is ever committed.

---

## Build phases

| Phase | Scope | Status |
| --- | --- | --- |
| 0 | Analysis, architecture, database design, API plan | ✅ Complete |
| 1 | Backend + frontend scaffolding, migrations, seed data | ⬜ |
| 2 | Authentication and role-based access | ⬜ |
| 3 | Customer CRM module | ⬜ |
| 4 | Products, inventory and stock movements | ⬜ |
| 5 | Sales challans with transactional stock deduction | ⬜ |
| 6 | Dashboard and complete frontend UX | ⬜ |
| 7 | Testing, validation and bug fixing | ⬜ |
| 8 | API documentation and Postman collection | ⬜ |
| 9 | Deployment | ⬜ |
| 10 | Final documentation and submission preparation | ⬜ |
