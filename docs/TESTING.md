# Testing

> Phase 7 deliverable. 254 automated tests — 236 backend integration tests against a real
> PostgreSQL database, 18 frontend unit tests — plus the five defects the exercise found and the
> fixes for them. Phase 8 added a third, complementary suite: 144 Postman assertions run against the
> live API with newman (§1).
> Related: [ARCHITECTURE.md](./ARCHITECTURE.md) · [API_DOCUMENTATION.md](./API_DOCUMENTATION.md) · [SALES_CHALLAN_MODULE.md](./SALES_CHALLAN_MODULE.md)

---

## 1. Running the tests

```bash
cd backend  && npm test     # 236 integration tests
cd frontend && npm test     #  18 unit tests
```

The backend suite needs a running PostgreSQL server — the same one `DATABASE_URL` already points
at. Nothing else has to be set up: `npm test` creates its own database, applies the migrations and
loads its own fixtures.

**It does not touch your development data.** `scripts/test.mjs` derives `<your_database>_test` from
`DATABASE_URL`, refuses to run if that name is not distinct from the real one, creates it if it does
not exist, and passes it to the test process as an environment override. The suite truncates every
table between files, so that guard is the difference between a clean run and losing the seed data.

Set `TEST_DATABASE_NAME` if you want a different name.

### The Postman collection is a third suite

Phase 8 added `postman/`, which is 56 requests carrying **144 assertions** over the live API. It is
not a replacement for the integration tests — it runs against whatever database the server is
pointed at, and it cannot reach inside a transaction to prove a concurrency property. What it does
add is an end-to-end check of the *deployed* thing: the same requests a reviewer would send by hand,
asserting the same contract.

```bash
npx newman run postman/Mini-ERP-CRM.postman_collection.json \
  -e postman/Mini-ERP-CRM.postman_environment.json
```

Against a seeded development database it passes with 0 failures, and passes again on an immediate
second run — the requests that would otherwise trip a unique constraint generate a timestamped
mobile number and SKU. Unlike `npm test`, **this one does write to the database you point it at**;
`npm run db:setup` restores the seed.

Running it also caught two defects in the collection itself before it was committed: the delete
example was soft-deleting the customer every later folder depended on, and the service-banner
request was pointed at `{{baseUrl}}` (which already ends in `/api`) rather than the host root.

---

## 2. What is tested, and what is deliberately not

**Integration tests over unit tests.** Every backend test drives the real Express app over real HTTP
against real PostgreSQL: helmet, CORS, body parsing, `authenticate`, `authorize`, `validate`,
controller, service, repository, database, error handler. Nothing is mocked.

That is not thoroughness for its own sake. The guarantees this system actually makes —

- stock can never go negative,
- confirming a challan is all-or-nothing,
- two simultaneous confirmations deduct stock once,

— are properties of `SELECT … FOR UPDATE`, a `CHECK` constraint and transactional rollback. **None
of them exist in a mocked repository.** A unit test with a fake database would prove that the mock
agrees with itself, pass with the row lock deleted, and say nothing about the thing the case study
is actually asking about.

The frontend is the opposite case: its pure functions are unit-tested, and its components are not
tested at all. That gap is stated plainly in §6 rather than papered over.

**Zero new test dependencies on the backend.** The runner is Node's built-in `node:test` with the
`tsx` loader the project already used. No Jest, no Vitest, no Supertest.

---

## 3. Coverage

| File | Tests | What it covers |
| --- | ---: | --- |
| `auth.test.ts` | 87 | Login, token handling, `GET /auth/me`, and the **full permission matrix** |
| `customers.test.ts` | 36 | CRM CRUD, validation, search, filters, pagination, soft delete, follow-ups |
| `products.test.ts` | 32 | Product master, the stock ledger, negative-stock prevention, **20-way concurrency** |
| `challans.test.ts` | 33 | Lifecycle, all-or-nothing deduction, product snapshot, **two concurrency proofs** |
| `platform.test.ts` | 19 | Response envelope, error contract, health, security headers, CORS, body limits |
| `dashboard.test.ts` | 16 | Every counter, cross-checked against the list endpoint behind it |
| `migrations.test.ts` | 8 | `migrate` and `seed` run as real subprocesses, including idempotency |
| **Total** | **231** | |

Plus 18 frontend unit tests over `utils/format.ts` and `utils/params.ts`.

### The permission matrix

`auth.test.ts` walks **18 protected routes × 4 roles = 72 generated cases**, asserting that every
role either gets past `authorize` or receives exactly 403 — never 404, never 422, never 500. A
73rd case asserts all 18 routes are 401 without a token.

This is why it matters: the permission matrix in
[AUTHENTICATION.md](./AUTHENTICATION.md) is prose, and prose cannot be executed. These 73 cases
check the documentation against the running code, so the two cannot drift apart silently.

### The concurrency proofs

Three tests exist specifically because a sequential test would pass even with the locking removed.

| Test | Setup | Asserted |
| --- | --- | --- |
| Stock ledger | 20 simultaneous `OUT` of 10 units against 100 in stock | exactly 10 succeed, 10 get 409, final stock is 0, never negative, ledger reconciles |
| One challan, two confirmations | The same challan confirmed twice at the same instant | one 200 and one 409; stock deducted **once**; exactly one ledger row |
| Eight challans, one product | 8 challans × 30 units against 100 in stock | exactly 3 confirm, 5 refused, final stock 10, ledger reconciles |

Each one also recomputes the ledger sum in SQL and asserts it equals `products.current_stock` — the
invariant, verified independently of the code that maintains it.

### The snapshot proof

A challan is confirmed, then the product is renamed, re-SKU'd and repriced. The challan still
reports the name, SKU and price it was signed with, and its total is unchanged — while
`item.productId` still points at the live product so analytics keep working. A second test confirms
the snapshot is taken at **confirmation**, not at drafting.

---

## 4. Defects found and fixed

Five real bugs, all found by this exercise, all fixed. Each one now has a regression test.

### 4.1 Importing the migration runner terminated the process

`src/db/migrate.ts` exported `runMigrations()` **and** called `main()` at module scope, where
`main()` ends with `pool.end()` and `process.exit(0)`. Any import of that module — which the test
harness needs, to build a schema — silently killed the importing process. `seed.ts` had the same
shape.

**Fix:** both scripts now run `main()` only under `if (require.main === module)`.

### 4.2 A body-less POST was rejected with 422

`POST /api/challans/:id/cancel` takes an **optional** `reason` ([API_PLAN.md](./API_PLAN.md) §3).
Sending no body at all returned `422 VALIDATION_ERROR`.

Express 5's JSON parser leaves `req.body` as `undefined` when a request carries no body, and a Zod
object schema rejects `undefined` even when every one of its fields is optional. Cancelling without
a reason — the documented, ordinary case — was impossible from curl or Postman. The frontend
happened to be unaffected because it always sends `{}`.

**Fix:** `validate()` treats an absent body as `{}`. This corrects every current and future
optional-body endpoint at once, and where a body *is* required the caller now gets per-field
"Required" messages instead of one opaque type error.

### 4.3 An oversized request body returned 500 instead of 413

Posting more than the 100 kB limit produced `500 INTERNAL_ERROR`.

body-parser throws an `http-errors`-style error carrying `status: 413` — and also a string `code`
property (`'ETOOLARGE'`). The error handler's `isPostgresError()` check is `typeof error.code ===
'string'`, so the payload error was mistaken for a database failure and fell through to the generic
500.

**Fix:** a new branch translates any error carrying a 4xx `status`/`statusCode` into the matching
response (413, 415, or a generic 4xx), placed **before** the Postgres check. Added
`PAYLOAD_TOO_LARGE` and `UNSUPPORTED_MEDIA_TYPE` to the error vocabulary.

### 4.4 Search terms were interpreted as LIKE patterns

Binding a search term as a parameter prevents SQL injection, but it does not stop the term being
read as a *pattern*: `_` matches any single character and `%` matches any run of them.

SKUs are explicitly allowed to contain underscores (`^[A-Za-z0-9_-]{2,50}$`), so searching for the
SKU `LOW_1` also returned `LOW-1` and `LOWX1`, with no way to search for the one actually meant. A
lone `%` matched every row in the table. All three list endpoints — customers, products, challans —
were affected.

**Fix:** a shared `likeContains()` helper escapes `\`, `%` and `_` before wrapping the term.

### 4.5 A mistyped page number showed an error screen

The four list screens read `Number(searchParams.get('page') ?? '1')`. `?page=abc` produced `NaN`,
which was sent to the API, correctly rejected with 422, and left the user looking at "Something went
wrong" instead of the first page. `?page=0` and `?page=-1` did the same.

**Fix:** a shared `parsePage()` helper falls back to 1 for anything that is not a whole number ≥ 1.

### Also added while testing

`LOG_LEVEL` is now a supported environment variable (`debug|info|warn|error|silent`). Unset, it
still derives from `NODE_ENV` — but the test suite needs `silent` to keep request logs out of the
assertion output, and a real deployment benefits from being able to turn the volume down without a
code change.

---

## 5. Notable behaviours the tests pin down

Some tests exist to lock in a decision, so that changing it has to be deliberate.

| Behaviour | Why it is what it is |
| --- | --- |
| Unknown email, wrong password and deactivated account return **identical** 401s | Otherwise login becomes a way to discover which company email addresses exist |
| A bad `:id` is **400**, a bad body field is **422** | `/customers/abc` is not a resource address at all; a well-formed request that fails a rule is a different kind of failure |
| `DELETE` returns **204** | The resource is gone; there is nothing meaningful to return |
| Deactivating a user does **not** invalidate their existing token | A documented trade-off for a stateless API — the test names it as such, so changing it is a conscious act |
| A confirmed challan cannot be cancelled | Giving stock back silently would let anyone inflate inventory by confirming and cancelling |
| Unknown request fields are **stripped**, not rejected | A slightly stale client is not broken by a new field |
| A soft-deleted customer frees its mobile number for reuse | The partial unique index covers live rows only |

---

## 6. What is not covered

Stated plainly, because a coverage claim is only useful if its edges are honest.

1. **No component or end-to-end tests.** Nothing drives a browser. React rendering, navigation,
   form interaction and the role-specific buttons are verified by the strict type checker, the API
   contract and manual use — not by an automated click. A Playwright smoke suite over
   login → dashboard → create challan → confirm is the obvious next step, and would have
   caught §4.5 automatically rather than by reading the code.
2. **No load or performance testing.** The concurrency tests prove *correctness* under simultaneous
   writes, not throughput. Nothing here says what happens at 500 requests per second.
3. **No coverage percentage.** The suite targets the guarantees the system makes rather than a line
   count, and a percentage would imply a precision it does not have.
4. **The `pg` driver and Express itself are not tested**, only how this application uses them.
5. **Timezone behaviour is tested only in the runner's timezone.** `formatDate` is written to be
   timezone-independent and is tested for it, but the suite is not re-run under several `TZ` values.
6. **No test for the 503 path** when the database disappears mid-request; simulating that reliably
   needs a proxy the project does not have.

---

## 7. Results

```text
backend   231 tests, 231 pass, 0 fail   (~64s, includes 3 concurrency tests)
frontend   18 tests,  18 pass, 0 fail   (<1s)
```

Both `npm run typecheck` and `npm run build` are clean on both projects, with TypeScript in strict
mode (`noUncheckedIndexedAccess`, `noUnusedLocals`).
