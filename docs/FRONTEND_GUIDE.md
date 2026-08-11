# Frontend Guide & Dashboard Module

> Phase 6 deliverable. The operations dashboard — every counter computed from a live query — plus
> the frontend conventions that every screen built in Phases 2–5 already follows, written down.
> Related: [ARCHITECTURE.md](./ARCHITECTURE.md) · [API_PLAN.md](./API_PLAN.md) · [AUTHENTICATION.md](./AUTHENTICATION.md)

---

## 1. What Phase 6 added

| Area | Change |
| --- | --- |
| API | `GET /api/dashboard/summary` — endpoint 26, the last one in the plan |
| Frontend | The dashboard replaces the placeholder home screen at `/` |
| Frontend | A real 404 page, framed by the app shell, instead of a silent redirect to `/` |
| Frontend | Sidebar navigation grouped into Sales / Inventory / System sections |
| Frontend | The top bar names the current screen instead of repeating the product name |
| Frontend | A "Follow-ups due" filter on the customer list, which the dashboard tile links into |

With this the API surface is complete: **all 26 planned endpoints implemented** (29 routes in total
once the three added along the way are counted — see
[API_DOCUMENTATION.md](./API_DOCUMENTATION.md) §11).

---

## 2. The dashboard

### 2.1 Design rule: no decorative numbers

Every figure on the screen is an aggregate computed at request time from the tables it describes.
There is no counters table, no cache, and no nightly rollup. That is a deliberate trade — a cached
dashboard is faster and is wrong the moment someone confirms a challan, and a number an operations
team cannot trust is worse than no number at all.

The second rule follows from the first: **every tile is a link to the rows behind it.** "4 low
stock" navigates to those four products. A counter the user cannot act on is decoration.

### 2.2 What each number means

| Field | Definition |
| --- | --- |
| `customers.total` | Customers where `deleted_at IS NULL`. Soft-deleted customers count nowhere. |
| `customers.active` / `.leads` | `status = 'ACTIVE'` / `'LEAD'`. `INACTIVE` is deliberately not shown — it is not actionable. |
| `customers.followUpsDue` | `follow_up_date IS NOT NULL AND follow_up_date <= CURRENT_DATE` — today counts as due, not overdue-only. |
| `products.total` | All products, active and inactive. |
| `products.lowStock` | Active products with `current_stock <= min_stock_alert` — the identical rule the product list's low-stock filter uses, so the tile and the list can never disagree. |
| `products.outOfStock` | Active products with `current_stock = 0`. A **subset** of `lowStock`, not a separate population: if stock is 0 it is necessarily `<=` a non-negative threshold. |
| `products.inactive` | `NOT is_active`. Excluded from the two stock counters — nobody needs to reorder a discontinued product. |
| `challans.draft/confirmed/cancelled` | Counts by status. |
| `challans.confirmedThisMonth` | `status = 'CONFIRMED' AND confirmed_at >= date_trunc('month', now())`. |
| `challans.valueThisMonth` | `sum(total_amount)` over exactly that set, as a 2-decimal string. |

Two decisions worth naming:

**Month is measured on `confirmed_at`, not `created_at`.** A challan drafted in July and confirmed
in August is August's dispatch, because August is when the goods actually left. Drafts and cancelled
challans contribute nothing to the month's value — nothing shipped.

**`valueThisMonth` is cast `::numeric(14,2)::text`.** `COALESCE(sum(...), 0)` falls back to an
*integer* literal in an empty month, which would serialise as `"0"` while every other money value in
the API is `"0.00"`. The cast keeps one format across the whole contract.

### 2.3 The lists

Three panels, five rows each:

- **Needs reordering** — active low-stock products, ordered by `current_stock - min_stock_alert`
  ascending. That surfaces the product furthest below its threshold first, which is not the same as
  the product with the smallest number: 8-of-30 is a worse position than 0-of-5 is comfortable, and
  a plain `ORDER BY current_stock` would rank them the other way round.
- **Recent challans** — newest first, with the customer's business name and status badge.
- **Recent stock movements** — newest first, signed by direction, showing the resulting balance.

### 2.4 Query strategy

Six statements, issued in parallel with `Promise.all`, on a pool sized 10 by default.

The three counter queries each use `count(*) FILTER (WHERE …)`, so all four customer counters come
from **one** pass over the table rather than four queries. Counts are cast `::int` because
PostgreSQL returns `count()` as `BIGINT`, which `pg` hands back as a string to protect precision —
these counts are far below 2³¹, so the cast is safe and keeps the JSON numeric.

They are **not** wrapped in a transaction. A shared snapshot would only matter if the numbers were
compared against one another arithmetically, and no tile does that — each stands alone. Six short
reads are cheaper than holding a transaction open across all of them.

### 2.5 Access

`DASHBOARD_READ = every role.` The dashboard aggregates data each role can already reach through the
module screens, so restricting it would hide nothing — it would only make the landing page useless
for Warehouse and Accounts. Authentication is still required; there is no anonymous view.

---

## 3. Frontend architecture

```text
src/
├── api/          one module per resource + client.ts (the only axios instance)
├── components/   ui/ primitives — Button, Field, Pagination, StatTile, States
├── config/       env.ts — the only reader of import.meta.env
├── context/      AuthContext — the app's only global state
├── hooks/        useApi (loading/error/data), useDebounce
├── layouts/      AppLayout — sidebar, top bar, content outlet
├── pages/        one folder per screen, each with its own .module.css
├── routes/       ProtectedRoute, RoleRoute
├── styles/       tokens.css, global.css
├── types/        one file per domain area, mirroring the API contract
└── utils/        format.ts — dates and money, formatted in exactly one place
```

The dependency direction is one-way: `pages → hooks/api → client`. A page never imports axios, never
reads `localStorage`, and never builds a URL by hand. That is why the session-expiry rule — a 401
clears the token and bounces to `/login` — lives in one interceptor and applies to every endpoint
without a single page knowing about it.

**State lives where it is used.** Only authentication is global. Everything else is fetched per
screen through `useApi`, so there is no client-side cache that can disagree with the server. For an
internal portal at this scale that is the right trade: one extra request on navigation, zero
staleness bugs.

---

## 4. Conventions every screen follows

### 4.1 Four states, never three

Loading, error, empty, success — `useApi` returns the first three explicitly and the shared
`InlineSpinner` / `ErrorState` / `EmptyState` components render them, so "what does this look like
with no data?" is answered on every screen rather than discovered in a demo.

Empty states are written for the situation, not generically. The customer list says *"No follow-ups
are due"* when the follow-up filter is on and *"No customers yet"* when the table is genuinely
empty, and only offers "Add customer" in the second case — offering it in the first would suggest
the filter was the problem.

`useApi` also guards two things that are easy to get wrong: it discards a stale response whose
request has been superseded (type fast in a search box and the slow first response cannot overwrite
the fast second one), and it never sets state after unmount.

### 4.2 Filter state lives in the URL

Search, filters and page number are all `searchParams`. A filtered view can be bookmarked, shared
with a colleague, and survives the back button. Changing any filter resets to page 1 — staying on
page 4 of a result set that now has two pages shows an empty table for no reason.

This is also what makes the dashboard tiles work: they are ordinary links to
`/products?lowStock=true` and `/customers?followUpBefore=<today>`, requiring no cross-screen state.

### 4.3 Role-aware UI is a courtesy, not a control

`hasRole()` hides actions the signed-in role cannot perform, and `RoleRoute` keeps them out of the
write screens. Both improve the experience; **neither is security.** Anyone can call the API
directly, so `authenticate` and `authorize` enforce the same matrix server-side, independently. The
dashboard follows this: Warehouse is not offered "New challan" only to be bounced to `/forbidden`.

### 4.4 Navigation and titles

The sidebar groups modules the way the business does — Sales, Inventory, System — so each role finds
its own work in one place. A section disappears entirely if the role can see none of its links,
which is why an Admin-only Users link does not leave an empty "System" heading for Sales.

The top bar names the current screen, resolved from the pathname by a most-specific-first pattern
list, so `/customers/new` reads "New customer" rather than falling through to "Customers".

### 4.5 404

An unknown path now renders a 404 inside the app shell instead of silently redirecting to `/`. The
redirect hid the mistake: a stale bookmark looked exactly like a working link that decided to go
somewhere else. The catch-all sits **inside** the auth guard, so a signed-out visitor following a
stale link is still sent to `/login` and returned afterwards.

### 4.6 Styling

Every colour, space, radius and type size is a token in `styles/tokens.css`; components reference
tokens and never a raw value. Page styles are CSS Modules scoped to their page; only genuinely
shared primitives (`.card`, `.badge`, `.table`) live in `global.css`.

Accessibility and responsiveness are handled as defaults rather than a pass at the end: one visible
`:focus-visible` treatment app-wide, `aria-label` on every unlabelled control, `aria-pressed` on the
follow-ups toggle, `role="status"` on loading and success regions, `prefers-reduced-motion` honoured
in the token file, wide tables scrolling inside `.table-wrap` instead of the page, and the sidebar
collapsing to a horizontal bar under 860px.

---

## 5. Test results

Run against a seeded development database (7 customers, 10 products), backend on `:4000`.

### Dashboard endpoint

| # | Test | Result |
| --- | --- | --- |
| 1 | `GET /api/dashboard/summary` with no token | ✅ 401 `UNAUTHENTICATED` |
| 2 | …with a malformed token | ✅ 401 `UNAUTHENTICATED` |
| 3 | …as ADMIN | ✅ 200, full payload |
| 4 | …as SALES / WAREHOUSE / ACCOUNTS | ✅ 200 for all three, identical figures |
| 5 | Response shape matches `API_PLAN.md` §3 | ✅ all six sections present |

### Counter correctness

| # | Test | Result |
| --- | --- | --- |
| 6 | `customers.total` = 7 (seeded), `active` = 4, `leads` = 2 | ✅ |
| 7 | `customers.followUpsDue` = 3 | ✅ matches `GET /api/customers?followUpBefore=<today>` → `pagination.total` = 3 |
| 8 | `products.lowStock` = 4, `outOfStock` = 1 | ✅ out-of-stock product also appears in the low-stock set, as specified |
| 9 | Empty month → `valueThisMonth` | ✅ `"0.00"`, not `"0"` |
| 10 | Create a **draft** challan (₹420.00) | ✅ `total` 0→2*, `draft` 0→1; `confirmedThisMonth` unchanged at 0 — a draft ships nothing |
| 11 | Create a **confirmed** challan (₹4,300.00) | ✅ `confirmed` = 1, `confirmedThisMonth` = 1, `valueThisMonth` = `"4300.00"` |
| 12 | `recentChallans` after both | ✅ both rows, newest first, with business name and status |
| 13 | `recentMovements` after the confirmation | ✅ the `OUT` movement appears first, quantity 2, `balanceAfter` 38 (from 40) |
| 14 | `lowStockProducts` ordering | ✅ MCB (8/30, −22) before LED (15/25, −10) before Ladder (0/5, −5) — deficit order, not raw stock |

\* both challans were created in the same step of the run.

### Frontend

| # | Test | Result |
| --- | --- | --- |
| 15 | `npm run typecheck` (strict) | ✅ clean |
| 16 | `npm run build` | ✅ 145 modules, 300.65 kB JS (95.06 kB gzip) |
| 17 | Backend `npm run typecheck` / `npm run build` | ✅ clean |

**Not yet covered:** the dashboard has not been exercised by an automated browser session —
rendering, navigation from each tile, and the role-specific action buttons are verified by the
strict type checker, by the API contract and by manual use, not by an automated click.

Phase 7 did not close this gap: it added 231 backend integration tests and 18 frontend *unit* tests,
and deliberately did not introduce a browser-automation dependency. The gap is recorded honestly in
[TESTING.md](./TESTING.md) §6 as the first item, along with why a Playwright smoke suite is the
obvious next step.

---

## 6. Known limitations

1. **No browser-level verification yet** — see above; Phase 7.
2. **The dashboard does not auto-refresh.** It loads on mount and on the explicit Refresh button.
   Polling would add load for a number that changes a few times an hour; a manual refresh is honest
   about when the figures were taken.
3. **`current_stock <= min_stock_alert` cannot use an index** because it compares two columns. At
   this scale it is a sequential scan over a small table; the same limitation is recorded in
   [INVENTORY_MODULE.md](./INVENTORY_MODULE.md).
4. **"This month" follows the database server's clock,** not the viewer's timezone. For a
   single-country distributor that is correct and simpler than a per-user timezone setting.
5. **No charts.** Trends over time would need date-bucketed queries that the case study does not
   ask for, and a sparkline over two weeks of data would say nothing true.
6. **The recent lists are capped at 5** and have no "load more" — they are a glance, not a report.
   Each panel links to the full, filterable list.
