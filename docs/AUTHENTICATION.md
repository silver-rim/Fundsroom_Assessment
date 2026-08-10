# Authentication & Role-Based Access

> Phase 2 deliverable. How a user proves who they are, and what each role is allowed to do.
> Related: [ARCHITECTURE.md](./ARCHITECTURE.md) · [API_PLAN.md](./API_PLAN.md) · [DATABASE_DESIGN.md](./DATABASE_DESIGN.md)

---

## 1. Overview

Stateless JWT authentication. A user posts their email and password once, receives a signed token,
and sends that token on every subsequent request. The server keeps no session store, which is what
makes the API restartable and free-tier friendly.

Authorization is enforced **on the server, on every protected route**. The React app hides screens a
role cannot use, but that is a convenience: anyone can call the API directly with `curl`, so the
frontend is never treated as a security boundary.

```text
┌──────────┐  1. POST /api/auth/login {email, password}   ┌──────────────┐
│  Browser │ ───────────────────────────────────────────► │  Express API │
│          │ ◄─────────────────────────────────────────── │              │
│          │  2. { token, expiresIn, user }               └──────┬───────┘
│          │                                                     │ bcrypt.compare
│ localSt. │  3. Authorization: Bearer <token>                   │ against users.password_hash
│  token   │ ───────────────────────────────────────────►        ▼
└──────────┘                                              ┌──────────────┐
                                                          │  PostgreSQL  │
     authenticate → authorize(ROLE_GROUP) → controller     └──────────────┘
```

---

## 2. Roles

| Role | Who they are | Scope |
| --- | --- | --- |
| `ADMIN` | Owner / operations manager | Everything |
| `SALES` | Field & counter sales | Customers, follow-ups, challans; read-only on stock |
| `WAREHOUSE` | Storekeeper / dispatch | Products, stock movements, challan confirmation |
| `ACCOUNTS` | Billing / accounts | Read-only across all modules |

A user holds exactly one role, stored in `users.role` and constrained by
`CHECK (role IN ('ADMIN','SALES','WAREHOUSE','ACCOUNTS'))`.

---

## 3. Endpoints

### `POST /api/auth/login` — public

```jsonc
// request
{ "email": "admin@minierp.local", "password": "Admin@12345" }

// 200 OK
{
  "success": true,
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9…",
    "expiresIn": 28800,
    "user": {
      "id": 1,
      "name": "Asha Menon",
      "email": "admin@minierp.local",
      "role": "ADMIN",
      "isActive": true,
      "createdAt": "2026-08-10T13:20:04.981Z"
    }
  }
}
```

| Outcome | Status | Code |
| --- | --- | --- |
| Success | 200 | — |
| Missing / malformed email or password | 422 | `VALIDATION_ERROR` (with per-field `details`) |
| Body is not valid JSON | 400 | `BAD_REQUEST` |
| Unknown email **or** wrong password **or** deactivated account | 401 | `INVALID_CREDENTIALS` |

Email matching is **case-insensitive** — `ADMIN@MiniErp.Local` signs in the same account as
`admin@minierp.local`, resolved through the `uq_users_email_lower` functional index.

### `GET /api/auth/me` — any authenticated role

Returns the current user's profile. The frontend calls this on page load to turn a stored token back
into a session, so a revoked or stale token cannot produce a logged-in-looking UI.

```jsonc
{ "success": true,
  "data": { "id": 2, "name": "Nikhil Rao", "email": "sales@minierp.local",
            "role": "SALES", "isActive": true, "createdAt": "…" } }
```

### `GET /api/users` — Admin only

Lists employee accounts. **Added during Phase 2** beyond the 26 endpoints planned in
`API_PLAN.md`: an Admin needs to see who has portal access, and it gives the permission system a
concrete route to be verified against (401 / 403 / 200 across the four roles). Read-only —
user management is out of MVP scope (assumption A7).

---

## 4. Login flow, step by step

1. `validate({ body: loginSchema })` — Zod trims the email, lower-cases it, checks the address shape
   and the presence of a password. Failure → **422** listing every bad field at once.
2. `authService.login` loads the user by `lower(email)`.
3. `bcrypt.compare` runs against the stored hash — **or against a dummy hash if no user was found**.
   See §8 on timing.
4. If the user is missing, the password is wrong, or the account is inactive → **401
   `INVALID_CREDENTIALS`**, one identical message for all three.
5. Otherwise a JWT is signed and returned with the public user object. The password hash is removed
   by destructuring, so it cannot ride along into the response.

---

## 5. Token design

```jsonc
// header
{ "alg": "HS256", "typ": "JWT" }

// payload
{ "role": "ADMIN", "iat": 1786...., "exp": 1786...., "sub": "1", "iss": "mini-erp-crm" }
```

| Decision | Value | Why |
| --- | --- | --- |
| Algorithm | HS256, **pinned on verify** | `algorithms: ['HS256']` stops an attacker presenting a token that declares `alg: none` and having it accepted unverified. |
| Secret | `JWT_SECRET` from the environment, min 32 chars | Enforced at boot by `config/env.ts` — the process refuses to start with a short or missing secret. |
| Lifetime | `JWT_EXPIRES_IN`, default `8h` | Roughly one working shift. |
| Issuer | `mini-erp-crm`, checked on verify | Rejects a validly-signed token minted for a different system sharing the secret. |
| Contents | `sub` (user id) and `role` only | The client already has name and email from the login response. **A JWT is signed, not encrypted** — anything inside it is readable by whoever holds it, so it carries the minimum. |

The role is read from the token rather than re-queried per request. That keeps the API stateless and
saves a database round-trip on every call. **Trade-off:** changing a user's role, or deactivating
them, takes effect at their next login rather than instantly (up to 8 hours). `GET /api/auth/me`
does hit the database, so a deactivated user is signed out by the frontend on their next page load.

---

## 6. Password storage

- Hashed with **bcrypt** (`bcryptjs`, a pure-JS implementation so `npm install` needs no C++
  toolchain on Windows or on a free-tier build container). Cost factor from `BCRYPT_SALT_ROUNDS`,
  default 10.
- Plaintext is never stored, never logged, and never returned.
- Hashes live only on `UserWithCredentials`, which is returned by exactly one repository function
  used by exactly one service. Every other path uses `PublicUser`, a type that **has no
  `passwordHash` field** — so a response object cannot carry a hash even by mistake.
- Verified in the database: all four seeded accounts store 60-character `$2b$10$…` hashes.

---

## 7. Permission matrix

Legend: **F** full · **R** read-only · **—** no access

| Capability | Admin | Sales | Warehouse | Accounts |
| --- | :---: | :---: | :---: | :---: |
| Log in, view own profile (`/auth/me`) | F | F | F | F |
| List users (`/users`) | F | — | — | — |
| **Customers** — list / search / view | F | F | R | R |
| **Customers** — create, edit | F | F | — | — |
| **Customers** — soft delete | F | — | — | — |
| **Follow-ups** — view | F | F | — | R |
| **Follow-ups** — add | F | F | — | — |
| **Products** — list / search / view | F | R | F | R |
| **Products** — create, edit, deactivate | F | — | F | — |
| **Stock movements** — view log | F | R | F | R |
| **Stock movements** — record manual IN/OUT | F | — | F | — |
| **Challans** — list / view | F | F | R | R |
| **Challans** — create / edit draft | F | F | — | — |
| **Challans** — confirm (deducts stock) | F | F | F | — |
| **Challans** — cancel a draft | F | F | — | — |

### The matrix is code, not prose

`backend/src/config/permissions.ts` declares each row as a named group, and routes reference the
group instead of listing roles inline:

```ts
router.get('/', authenticate, authorize(USER_READ), asyncHandler(userController.listUsers));
```

So the table above can be checked against real code rather than trusted. Groups defined:
`CUSTOMER_READ/WRITE/DELETE`, `FOLLOW_UP_READ/WRITE`, `PRODUCT_READ/WRITE`, `STOCK_READ/WRITE`,
`CHALLAN_READ/WRITE/CONFIRM/CANCEL`, `USER_READ`. The customer, product, stock and challan groups are
consumed as their modules land in Phases 3–5.

### Why the non-obvious cells

- **Sales reads products and stock but cannot adjust either** — they must know what is available
  before promising a delivery; correcting a stock figure by hand is a warehouse responsibility.
- **Warehouse can confirm a challan** — confirmation is the moment goods physically leave the
  building. But Warehouse cannot create or price one.
- **Accounts is read-only everywhere** — their MVP job is reconciliation. No write path at all is the
  safest default; billing writes arrive with the invoice module.
- **Only Admin deletes** — even a soft delete is the most irreversible-feeling action available.

---

## 8. Security decisions

| Measure | Implementation |
| --- | --- |
| **No account enumeration** | Unknown email, wrong password and inactive account return byte-identical 401 responses. The operator-facing reason is written to the server log, where it is genuinely needed, not to the client. |
| **No timing-based enumeration** | When the email does not exist, bcrypt still runs against a fixed dummy hash. Without this, an unknown email would return in ~1 ms and a known one in ~80 ms, and identical messages would not matter — the clock would give it away. |
| **`alg: none` rejected** | `algorithms: ['HS256']` on verify. Verified: a hand-crafted unsigned token is refused. |
| **Forged role rejected** | The payload's `role` is checked against the `ROLES` whitelist, so a token claiming `SUPERUSER` fails even with a valid signature. |
| **Secrets from the environment** | `JWT_SECRET` is never hard-coded and is validated at boot. `.env` is git-ignored. |
| **Passwords never logged** | The login failure log records the email and reason, never the submitted password. |
| **No stack traces in production** | The error handler attaches `stack` only when `NODE_ENV !== 'production'`. |
| **Login rejects unknown fields** | Zod strips anything not in the schema, so extra body properties cannot reach the service. |
| **CORS allow-list** | Only origins in `CORS_ORIGINS` may call the API; anything else gets 403. |

### Known limitations (deliberate, documented)

1. **Token in `localStorage`** — readable by injected JavaScript, so an XSS bug becomes a token
   theft. An `httpOnly` cookie would be stronger but requires CSRF protection plus a cross-site
   cookie configuration between Vercel and Render that is disproportionate here.
2. **No refresh tokens** — the session simply ends after `JWT_EXPIRES_IN` and the user signs in
   again.
3. **No server-side revocation** — signing out clears the token in the browser; the token itself
   stays cryptographically valid until it expires. Revocation would need a deny-list, i.e. state.
4. **No rate limiting on login** — an attacker can attempt passwords as fast as bcrypt allows
   (~10/second at cost 10, which is a meaningful but not sufficient brake). `express-rate-limit`
   is the fix and is listed as a future enhancement.
5. **No password reset or change flow** — accounts are seeded (assumption A7).
6. **Role changes lag by up to one token lifetime** — see §5.

---

## 9. Middleware

| Middleware | File | Responsibility |
| --- | --- | --- |
| `authenticate` | `middleware/authenticate.ts` | Parses `Authorization: Bearer <token>`, verifies it, sets `req.user = { id, role }`. Throws 401 for missing / malformed / invalid / expired tokens. |
| `authorize(roles)` | `middleware/authorize.ts` | Compares `req.user.role` against a permission group. Throws 403 on mismatch, 401 if no user (which would mean the route forgot `authenticate`). |
| `validate(schemas)` | `middleware/validate.ts` | Parses body / params / query with Zod in one pass. Results go to `req.validated` — Express 5 exposes `req.query` through a getter with no setter, so parsed values cannot be written back onto the request. |

Order is always `authenticate → authorize → validate → controller`: identity, then permission, then
input shape. Rejecting an unauthorised caller before parsing their payload is both cheaper and
safer.

---

## 10. Error responses

| Situation | Status | Code |
| --- | --- | --- |
| Bad credentials | 401 | `INVALID_CREDENTIALS` |
| No / malformed / forged token | 401 | `UNAUTHENTICATED` |
| Expired token | 401 | `TOKEN_EXPIRED` |
| Wrong role | 403 | `FORBIDDEN` |
| Invalid input | 422 | `VALIDATION_ERROR` |
| Malformed JSON | 400 | `BAD_REQUEST` |

`TOKEN_EXPIRED` is deliberately distinct from `UNAUTHENTICATED` so the frontend can say "your
session expired, sign in again" instead of the alarming "invalid token".

```jsonc
{ "success": false,
  "error": { "code": "FORBIDDEN",
             "message": "You do not have permission to perform this action. Required role: ADMIN." } }
```

---

## 11. Frontend session handling

| Concern | Where | Behaviour |
| --- | --- | --- |
| Token storage | `api/client.ts` | `localStorage` under `mini-erp-crm.token`. One constant, one reader. |
| Attaching the token | `api/client.ts` request interceptor | Adds `Authorization: Bearer …` to every request. No component sets this header. |
| Session restore | `context/AuthContext.tsx` | On load, an existing token is exchanged for a profile via `/auth/me`. Fetched from the server, not decoded from the token. |
| Expiry / revocation | `api/client.ts` response interceptor | Any 401 clears the token and redirects to `/login` — except when already on `/login`, so a wrong password shows an error instead of reloading the page. |
| Route protection | `routes/ProtectedRoute.tsx` | `ProtectedRoute` requires a session; `RoleRoute allow={[…]}` requires a role and redirects to `/forbidden`. |
| Return-to path | `ProtectedRoute` → `LoginPage` | The attempted path travels in router state, so signing in returns the user where they were going. |
| Role-aware navigation | `layouts/AppLayout.tsx` | A nav link renders only if the role can use it. Cosmetic — the API enforces the rule. |
| Sign out | `AuthContext.logout` | Clears the token and the user; `ProtectedRoute` redirects on the next render. |

There is no flash of the login screen on refresh: `isInitialising` holds a spinner while the stored
token is being verified.

---

## 12. Test results

Executed against the running API on 2026-08-10. Full commands in §13.

### Login

| # | Scenario | Expected | Actual | ✓ |
| --- | --- | --- | --- | --- |
| 1 | Valid credentials (ADMIN) | 200 + token | 200, `expiresIn: 28800`, 189-char token | ✅ |
| 2 | Response contains no password hash | absent | absent | ✅ |
| 3 | Wrong password | 401 `INVALID_CREDENTIALS` | 401 `INVALID_CREDENTIALS` — "Invalid email or password." | ✅ |
| 4 | Unknown email | identical to #3 | byte-identical | ✅ |
| 5 | Invalid email + missing password | 422 with both fields | 422, `body.email` and `body.password` both listed | ✅ |
| 6 | Mixed-case email | 200 | 200, resolves to `admin@minierp.local` | ✅ |
| 7 | Malformed JSON body | 400 `BAD_REQUEST` | 400 "Request body is not valid JSON." | ✅ |
| 8 | All four roles sign in | 200 ×4 | 200 ×4 | ✅ |

### Tokens

| # | Scenario | Expected | Actual | ✓ |
| --- | --- | --- | --- | --- |
| 9 | No `Authorization` header | 401 | 401 `UNAUTHENTICATED` | ✅ |
| 10 | Garbage token | 401 | 401 `UNAUTHENTICATED` | ✅ |
| 11 | Expired token | 401 `TOKEN_EXPIRED` | 401 `TOKEN_EXPIRED` — "Your session has expired." | ✅ |
| 12 | Signed with a different secret | 401 | 401 "Invalid authentication token." | ✅ |
| 13 | Valid signature, wrong issuer | 401 | 401 rejected | ✅ |
| 14 | `alg: none` forgery | 401 | 401 rejected | ✅ |
| 15 | Forged `role: SUPERUSER` | 401 | 401 rejected | ✅ |
| 16 | Valid token → `/auth/me` | 200 + profile | 200, correct email and role | ✅ |

### Authorization

| # | Route | Role | Expected | Actual | ✓ |
| --- | --- | --- | --- | --- | --- |
| 17 | `GET /api/users` | none | 401 | 401 `UNAUTHENTICATED` | ✅ |
| 18 | `GET /api/users` | ADMIN | 200 | 200, 4 users | ✅ |
| 19 | `GET /api/users` | SALES | 403 | 403 `FORBIDDEN` | ✅ |
| 20 | `GET /api/users` | WAREHOUSE | 403 | 403 `FORBIDDEN` | ✅ |
| 21 | `GET /api/users` | ACCOUNTS | 403 | 403 `FORBIDDEN` | ✅ |

**21 of 21 passed.**

---

## 13. How to test it yourself

```bash
# 1. Sign in
curl -s -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@minierp.local","password":"Admin@12345"}'

# 2. Use the token
TOKEN="<paste the token>"
curl -s http://localhost:4000/api/auth/me     -H "Authorization: Bearer $TOKEN"
curl -s http://localhost:4000/api/users       -H "Authorization: Bearer $TOKEN"

# 3. Wrong role -> 403
curl -s -X POST http://localhost:4000/api/auth/login -H "Content-Type: application/json" \
  -d '{"email":"sales@minierp.local","password":"Sales@12345"}'
curl -s -i http://localhost:4000/api/users -H "Authorization: Bearer <sales token>" | head -1

# 4. No token -> 401
curl -s -i http://localhost:4000/api/users | head -1
```

> On Windows PowerShell, `-d '{"...":"..."}'` loses its quotes before `curl` sees it. Put the JSON in
> a file and use `--data-binary "@body.json"`, or use `Invoke-RestMethod`.

### In the browser

1. Open <http://localhost:5173> — you are redirected to `/login`.
2. Click a demo account chip to fill the form, then **Sign in**.
3. As **Admin**, the sidebar shows **Users**; open it and you see all four accounts.
4. Sign out, sign in as **Sales** — the **Users** link is gone. Navigate to `/users` manually and you
   get the 403 page. The API refuses it too, independently.
5. Refresh any page — you stay signed in (the token is restored via `/auth/me`).
6. In DevTools, delete `mini-erp-crm.token` from localStorage and refresh — you are returned to
   `/login`.
