# API Documentation — Mini ERP + CRM Operations Portal

> Phase 8 deliverable. This is the **implemented** reference: every request and response below was
> captured from the running API against the seeded development database, not written from the plan.
> Where the implementation differs from [API_PLAN.md](./API_PLAN.md) (the Phase 0 design), the
> difference is called out in [§11](#11-differences-from-the-phase-0-plan) rather than quietly
> reconciled.
>
> Companion file: `postman/Mini-ERP-CRM.postman_collection.json` — every endpoint here, in order,
> with the login request wired to set the bearer token for the rest of the collection.

---

## 1. Base URL and quick start

| Environment | Base URL |
| --- | --- |
| Local | `http://localhost:4000/api` |
| Production | `https://<render-service>.onrender.com/api` — see [DEPLOYMENT.md](./DEPLOYMENT.md) |

Two endpoints are public — `GET /api/health` and `POST /api/auth/login`. Everything else needs
`Authorization: Bearer <token>`.

```bash
# 1. Log in and keep the token
TOKEN=$(curl -s -X POST http://localhost:4000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@fundsroom.local","password":"Admin@12345"}' \
  | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).data.token")

# 2. Use it
curl -s http://localhost:4000/api/dashboard/summary -H "Authorization: Bearer $TOKEN"
```

Seeded accounts (development only — passwords come from `backend/.env`):

| Email | Password | Role |
| --- | --- | --- |
| `admin@fundsroom.local` | `Admin@12345` | ADMIN |
| `sales@fundsroom.local` | `Sales@12345` | SALES |
| `warehouse@fundsroom.local` | `Warehouse@12345` | WAREHOUSE |
| `accounts@fundsroom.local` | `Accounts@12345` | ACCOUNTS |

---

## 2. Conventions

| Aspect | Rule |
| --- | --- |
| Prefix | Every route is mounted under `/api`. `GET /` (no prefix) returns a small service banner and exists only to confirm a deploy is live. |
| Format | JSON in, JSON out. Request bodies are capped at **100 kB**. |
| Case | Request and response fields are **camelCase**; the database is snake_case and the repository layer maps between them. |
| Money | A JSON **string** with two decimals (`"1250.00"`). Numbers would cross IEEE-754 and lose the precision the `NUMERIC` column exists to protect. |
| Dates | Instants are ISO-8601 UTC with `Z` (`"2026-08-11T13:38:09.164Z"`). Calendar dates are plain (`"2026-08-17"`). |
| Enums | Sent and returned UPPER_SNAKE. An unknown value is a 422 — never coerced, never defaulted. |
| Unknown body fields | **Stripped**, not rejected, so a slightly stale client is not broken by a field it does not know about. The one deliberate exception is `currentStock` on product writes, which is rejected loudly (see [`PUT /api/products/:id`](#put-apiproductsid)). |
| Idempotency | `PUT` and `PATCH` are idempotent. `POST /challans/:id/confirm` is not: a second call is a 409. |
| Trailing input | Query parameters a route does not declare are ignored. |

### 2.1 Response envelope

Every response has one of three shapes, so a client needs exactly one reader for success and one for
failure.

```jsonc
// single resource
{ "success": true, "data": { … } }

// collection
{ "success": true, "data": [ … ],
  "pagination": { "page": 1, "limit": 20, "total": 43, "totalPages": 3 } }

// error
{ "success": false,
  "error": { "code": "VALIDATION_ERROR", "message": "Request validation failed.",
             "details": [ { "field": "body.mobile", "message": "Enter a valid mobile number (10 to 15 digits)" } ] } }
```

`details` is present only when the failure is field-level. In non-production environments the error
object also carries a `stack` string; `NODE_ENV=production` drops it.

### 2.2 Common list parameters

Every list endpoint accepts these. Values are coerced from strings, so `?page=2` works as sent.

| Parameter | Type | Default | Notes |
| --- | --- | --- | --- |
| `page` | int ≥ 1 | `1` | |
| `limit` | int 1–100 | `20` | Above 100 is **rejected** with 422, not silently clamped — a client that asks for 500 rows should learn that it will not get them. |
| `search` | string ≤ 100 | — | Case-insensitive partial match; the fields searched are listed per endpoint. |
| `sortBy` | enum | per endpoint | Whitelisted names mapped to columns. User input never reaches the SQL string. |
| `sortOrder` | `asc` \| `desc` | `desc` | |

`totalPages` is `0` when `total` is `0`.

---

## 3. Authentication

`POST /api/auth/login` returns a JWT (HS256, 8-hour lifetime by default). Send it as
`Authorization: Bearer <token>` on every other request.

The token carries only the user id (`sub`) and `role` — no name, no email. A JWT is signed, not
encrypted, so anything inside it is readable by whoever holds it. The role is read from the token
rather than re-queried per request, which keeps the API stateless; the documented trade-off is that
**changing or deactivating a user takes effect at their next login, not instantly**.

| Situation | Status | `code` |
| --- | --- | --- |
| No header, or a header that is not `Bearer …` | 401 | `UNAUTHENTICATED` |
| Malformed token, bad signature, wrong issuer, or an algorithm other than HS256 | 401 | `UNAUTHENTICATED` |
| Well-formed token past its expiry | 401 | `TOKEN_EXPIRED` — the frontend treats this specifically: it logs out and redirects rather than showing a generic error |
| Wrong email, wrong password, or a deactivated account | 401 | `INVALID_CREDENTIALS` — identical for all three, so the endpoint cannot be used to discover which accounts exist |

---

## 4. Errors

### 4.1 Code table

| HTTP | `code` | Raised when |
| --- | --- | --- |
| 400 | `BAD_REQUEST` | Malformed JSON body, or a `:id` path segment that is not a positive integer |
| 401 | `UNAUTHENTICATED` | Missing or unusable credentials |
| 401 | `INVALID_CREDENTIALS` | Login rejected |
| 401 | `TOKEN_EXPIRED` | Valid signature, expired token |
| 403 | `FORBIDDEN` | Authenticated, but the role is not permitted. The message names the roles that are |
| 404 | `NOT_FOUND` | Resource absent, soft-deleted, or the route itself does not exist |
| 409 | `CONFLICT` | Generic uniqueness or foreign-key conflict |
| 409 | `DUPLICATE_MOBILE` / `DUPLICATE_SKU` / `DUPLICATE_EMAIL` | A specific unique constraint |
| 409 | `INVALID_STATE` | Illegal transition — confirming a confirmed challan, editing a non-draft, selling to an inactive customer, or putting a deactivated product on a challan |
| 409 | `INSUFFICIENT_STOCK` | A movement or confirmation would drive stock below zero |
| 413 | `PAYLOAD_TOO_LARGE` | Body above 100 kB |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | Reserved — see [§11](#11-differences-from-the-phase-0-plan) |
| 422 | `VALIDATION_ERROR` | Well-formed request that fails a schema rule |
| 500 | `INTERNAL_ERROR` | Unexpected failure. The message is always generic; the detail is logged server-side |
| 503 | `SERVICE_UNAVAILABLE` | The database is unreachable |

**Why 400 and 422 are split.** `/customers/abc` is not a resource address at all — the URL itself is
wrong, so it is a 400. A well-formed request whose *body or query* breaks a rule is a 422. The split
is visible in the `field` prefix: `params.*` problems are 400, `body.*` and `query.*` problems are
422.

### 4.2 Real examples

```jsonc
// 400 — GET /api/customers/abc
{ "success": false, "error": { "code": "BAD_REQUEST", "message": "Invalid URL parameter.",
  "details": [ { "field": "params.id", "message": "id must be a number" } ] } }

// 401 — no Authorization header
{ "success": false, "error": { "code": "UNAUTHENTICATED",
  "message": "Authentication required. Provide an Authorization: Bearer <token> header." } }

// 403 — WAREHOUSE calling POST /api/customers
{ "success": false, "error": { "code": "FORBIDDEN",
  "message": "You do not have permission to perform this action. Required role: ADMIN or SALES." } }

// 404 — unknown route
{ "success": false, "error": { "code": "NOT_FOUND", "message": "Route GET /api/nope does not exist." } }

// 413 — a 120 kB body
{ "success": false, "error": { "code": "PAYLOAD_TOO_LARGE",
  "message": "Request body is too large. The limit is 100 kB." } }

// 422 — POST /api/auth/login with {"email":"","password":""}
{ "success": false, "error": { "code": "VALIDATION_ERROR", "message": "Request validation failed.",
  "details": [ { "field": "body.email",    "message": "Email is required" },
               { "field": "body.email",    "message": "Enter a valid email address" },
               { "field": "body.password", "message": "Password is required" } ] } }
```

Body, params and query are all validated in **one pass**, so a caller gets every problem back at
once instead of fixing them one request at a time.

---

## 5. Endpoint index

30 routes. The Roles column lists who may call it; ADMIN is included everywhere.

| # | Method | Path | Auth | Roles |
| --- | --- | --- | --- | --- |
| 1 | `GET` | `/` | No | — |
| 2 | `GET` | `/api/health` | No | — |
| 3 | `POST` | `/api/auth/login` | No | — |
| 4 | `GET` | `/api/auth/me` | Yes | All |
| 5 | `GET` | `/api/users` | Yes | ADMIN |
| 6 | `GET` | `/api/customers` | Yes | All |
| 7 | `POST` | `/api/customers` | Yes | ADMIN, SALES |
| 8 | `GET` | `/api/customers/:id` | Yes | All |
| 9 | `PUT` | `/api/customers/:id` | Yes | ADMIN, SALES |
| 10 | `DELETE` | `/api/customers/:id` | Yes | ADMIN |
| 11 | `GET` | `/api/customers/:id/follow-ups` | Yes | ADMIN, SALES, ACCOUNTS |
| 12 | `POST` | `/api/customers/:id/follow-ups` | Yes | ADMIN, SALES |
| 13 | `GET` | `/api/customers/:id/challans` | Yes | All |
| 14 | `GET` | `/api/products` | Yes | All |
| 15 | `POST` | `/api/products` | Yes | ADMIN, WAREHOUSE |
| 16 | `GET` | `/api/products/categories` | Yes | All |
| 17 | `GET` | `/api/products/:id` | Yes | All |
| 18 | `PUT` | `/api/products/:id` | Yes | ADMIN, WAREHOUSE |
| 19 | `PATCH` | `/api/products/:id/status` | Yes | ADMIN, WAREHOUSE |
| 20 | `GET` | `/api/products/:id/movements` | Yes | All |
| 21 | `GET` | `/api/stock-movements` | Yes | All |
| 22 | `POST` | `/api/stock-movements` | Yes | ADMIN, WAREHOUSE |
| 23 | `GET` | `/api/challans` | Yes | All |
| 24 | `POST` | `/api/challans` | Yes | ADMIN, SALES |
| 25 | `GET` | `/api/challans/:id` | Yes | All |
| 26 | `GET` | `/api/challans/:id/pdf` | Yes | All |
| 27 | `PUT` | `/api/challans/:id` | Yes | ADMIN, SALES |
| 28 | `POST` | `/api/challans/:id/confirm` | Yes | ADMIN, SALES, WAREHOUSE |
| 29 | `POST` | `/api/challans/:id/cancel` | Yes | ADMIN, SALES |
| 30 | `GET` | `/api/dashboard/summary` | Yes | All |

`/api/products/categories` is declared before `/api/products/:id` so the literal path is not captured
as an id. `/api/challans/:id/pdf` is declared before `PUT /api/challans/:id` for readability only —
the methods differ, so no shadowing is possible either way.

### `GET /api/challans/:id/pdf`

The one endpoint that does not return the JSON envelope: the body **is** the document.

```text
200 OK
Content-Type: application/pdf
Content-Disposition: attachment; filename="CH-2026-000012.pdf"
```

Errors still use the envelope. The challan is loaded before a single byte is written, so an unknown
id is the same `404 NOT_FOUND` JSON as everywhere else rather than a truncated download.

Any role that may read a challan may download it — the PDF contains nothing `GET /api/challans/:id`
does not already return, so a narrower rule would guard the format rather than the data.

Drafts and cancelled challans render too, and each carries a banner saying so. A PDF outlives the
screen it was downloaded from, and a printed draft that looks like a dispatch note is a worse
outcome than refusing the download would be.

---

## 6. Reference

### System

#### `GET /` — service banner

```jsonc
{ "success": true, "data": { "name": "Mini ERP + CRM Operations Portal API",
                             "version": "1.0.0", "docs": "/api/health" } }
```

#### `GET /api/health` — liveness + database

Public, unauthenticated, and excluded from request logging (it is polled constantly and would
otherwise bury real traffic).

```jsonc
// 200 — healthy
{ "success": true,
  "data": { "status": "ok", "environment": "development", "uptimeSeconds": 592,
            "timestamp": "2026-08-11T13:39:19.353Z",
            "database": { "status": "up", "latencyMs": 0 } } }
```

When the database is unreachable the endpoint answers **503** with `"status": "degraded"` and
`"database": { "status": "down", "latencyMs": null }`. It reports the outage rather than failing with
a 500, and the driver error is never included — it can contain the connection host and username.

---

### Authentication

#### `POST /api/auth/login`

```jsonc
// request
{ "email": "admin@fundsroom.local", "password": "Admin@12345" }

// 200
{ "success": true,
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9…",
    "expiresIn": 28800,
    "user": { "id": 1, "name": "Asha Menon", "email": "admin@fundsroom.local",
              "role": "ADMIN", "isActive": true, "createdAt": "2026-08-10T13:20:04.129Z" } } }
```

`email` is trimmed and lower-cased before lookup. `password` is checked only for presence and a sane
length (≤ 128) — enforcing complexity rules on a *login* form tells an attacker what passwords look
like and locks out users whose password predates the rule. `expiresIn` is read back off the signed
token, so it is always the real lifetime rather than a re-interpretation of the config string.

| Outcome | Status | `code` |
| --- | --- | --- |
| Missing or malformed fields | 422 | `VALIDATION_ERROR` |
| Unknown email, wrong password, or inactive account | 401 | `INVALID_CREDENTIALS` |

#### `GET /api/auth/me`

Rehydrates a session after a page refresh — the frontend holds the token but not the profile.

```jsonc
{ "success": true,
  "data": { "id": 1, "name": "Asha Menon", "email": "admin@fundsroom.local",
            "role": "ADMIN", "isActive": true, "createdAt": "2026-08-10T13:20:04.129Z" } }
```

#### `GET /api/users` — ADMIN only

Who has access to the portal. Read-only: user administration is out of scope for the case study, so
there is no create/update/delete counterpart.

```jsonc
{ "success": true,
  "data": [ { "id": 1, "name": "Asha Menon", "email": "admin@fundsroom.local",
              "role": "ADMIN", "isActive": true, "createdAt": "2026-08-10T13:20:04.129Z" },
            { "id": 2, "name": "Nikhil Rao", "email": "sales@fundsroom.local",
              "role": "SALES", "isActive": true, "createdAt": "2026-08-10T13:20:04.129Z" } ] }
```

Not paginated — the staff list is small and bounded by design.

---

### Customers

#### `GET /api/customers`

| Parameter | Values | Notes |
| --- | --- | --- |
| `search` | string ≤ 100 | Matches `name`, `businessName`, `mobile`, `email`, case-insensitively |
| `status` | `LEAD` \| `ACTIVE` \| `INACTIVE` | |
| `customerType` | `RETAIL` \| `WHOLESALE` \| `DISTRIBUTOR` | |
| `followUpBefore` | `YYYY-MM-DD` | Customers whose follow-up is due on or before this date |
| `sortBy` | `createdAt` \| `name` \| `businessName` \| `followUpDate` | Default `createdAt` |
| `sortOrder` | `asc` \| `desc` | Default `desc` |

Soft-deleted customers never appear.

```jsonc
// 200 — GET /api/customers?limit=1
{ "success": true,
  "data": [
    { "id": 7, "name": "Mahesh Gupta", "mobile": "9123456780",
      "email": "mahesh@guptatrading.in", "businessName": "Gupta Trading Co",
      "gstNumber": "09AAFCG3421M1ZK", "customerType": "WHOLESALE",
      "address": "5 Hazratganj, Lucknow, Uttar Pradesh 226001", "status": "ACTIVE",
      "followUpDate": null, "notes": null,
      "createdBy": { "id": 1, "name": "Asha Menon" },
      "createdAt": "2026-08-10T13:20:04.129Z", "updatedAt": "2026-08-10T13:20:04.129Z" } ],
  "pagination": { "page": 1, "limit": 1, "total": 7, "totalPages": 7 } }
```

#### `GET /api/customers/:id`

Same object, unwrapped. 404 if absent or soft-deleted.

#### `POST /api/customers` → 201

| Field | Required | Rule |
| --- | --- | --- |
| `name` | ✅ | 2–120 chars |
| `mobile` | ✅ | 10–15 digits **after** stripping spaces, `+`, `-`, `(`, `)` |
| `email` | ✅ | Valid email ≤ 254 chars, stored lower-cased |
| `businessName` | ✅ | 2–150 chars |
| `customerType` | ✅ | `RETAIL` \| `WHOLESALE` \| `DISTRIBUTOR` |
| `address` | ✅ | 5–500 chars |
| `gstNumber` | — | 15-character GSTIN pattern, stored upper-cased. Format only — no checksum, no government lookup |
| `status` | — | Defaults to `LEAD` |
| `followUpDate` | — | `YYYY-MM-DD`, must be a real calendar date (`2026-02-31` is rejected) |
| `notes` | — | ≤ 2000 chars |

Empty strings on optional fields are treated as "not provided" and stored as `NULL`, so an untouched
HTML form input does not become a validation error.

```jsonc
// request
{ "name": "Priya Nair", "mobile": "+91 98450 11223", "email": "Priya@NairEnterprises.in",
  "businessName": "Nair Enterprises", "gstNumber": "29aabcn7654p1z3",
  "customerType": "RETAIL", "address": "22 Brigade Road, Bengaluru, Karnataka 560001",
  "followUpDate": "2026-08-20", "notes": "Walk-in enquiry for LED panels." }

// 201 — note the normalisation the server applied
{ "success": true,
  "data": { "id": 19, "name": "Priya Nair", "mobile": "919845011223",
            "email": "priya@nairenterprises.in", "businessName": "Nair Enterprises",
            "gstNumber": "29AABCN7654P1Z3", "customerType": "RETAIL",
            "address": "22 Brigade Road, Bengaluru, Karnataka 560001", "status": "LEAD",
            "followUpDate": "2026-08-20", "notes": "Walk-in enquiry for LED panels.",
            "createdBy": { "id": 1, "name": "Asha Menon" },
            "createdAt": "2026-08-11T13:34:30.796Z", "updatedAt": "2026-08-11T13:34:30.796Z" } }
```

Duplicate mobile → 409:

```jsonc
{ "success": false, "error": { "code": "DUPLICATE_MOBILE",
  "message": "A customer with this mobile number already exists.",
  "details": [ { "field": "body.mobile", "message": "This mobile number is already registered" } ] } }
```

The uniqueness check runs in the service so the message can name the field, and the partial unique
index over live rows stands behind it to catch a race between two simultaneous creates. A number
belonging to a soft-deleted customer is free to reuse.

#### `PUT /api/customers/:id` → 200

A **full replacement**: every required field must be present, and `status` is required here (no
default). The edit form always submits the complete record, and a PUT that silently keeps unsent
fields is neither PUT nor PATCH. Reusing the customer's own mobile number is fine; taking another
customer's is 409 `DUPLICATE_MOBILE` with *"Another customer is already using this mobile number."*

#### `DELETE /api/customers/:id` → 204 — ADMIN only

Soft delete: `deleted_at` is stamped and the row disappears from every read path. No body is
returned. A second delete is a 404. Challans already raised for the customer are untouched — the
documents remain valid history.

#### `GET /api/customers/:id/follow-ups`

Newest first. Accepts `page` and `limit` only. A bad customer id is a 404 rather than an empty list,
which would read as "no follow-ups yet".

```jsonc
{ "success": true,
  "data": [ { "id": 3, "customerId": 19,
              "note": "Called about the 40-unit LED panel order. Will confirm on Monday.",
              "nextFollowUpDate": "2026-08-17",
              "createdBy": { "id": 1, "name": "Asha Menon" },
              "createdAt": "2026-08-11T13:34:46.535Z" } ],
  "pagination": { "page": 1, "limit": 20, "total": 1, "totalPages": 1 } }
```

#### `POST /api/customers/:id/follow-ups` → 201

```jsonc
{ "note": "Called about the 40-unit LED panel order. Will confirm on Monday.",
  "nextFollowUpDate": "2026-08-17" }
```

`note` is required (1–2000 chars). When `nextFollowUpDate` is present, the customer's own
`followUpDate` is moved to match **in the same transaction**, so the CRM list and the note history
can never disagree about when the next call is due.

#### `GET /api/customers/:id/challans`

Challans raised for this customer, newest first, `page`/`limit` only. Returns the challan **summary**
shape (see [§6 Challans](#challans)) — header fields plus `itemCount`, without line items.

---

### Products

#### `GET /api/products`

| Parameter | Values | Notes |
| --- | --- | --- |
| `search` | string ≤ 100 | Matches `name`, `sku`, `category` |
| `category` | string ≤ 80 | Exact category |
| `lowStock` | `true` \| `false` | `true` → only `currentStock <= minStockAlert` |
| `isActive` | `true` \| `false` \| `all` | **Defaults to `true`** — deactivated products are hidden unless asked for, because they cannot be sold |
| `sortBy` | `createdAt` \| `name` \| `sku` \| `category` \| `unitPrice` \| `currentStock` | Default `createdAt` |

```jsonc
{ "success": true,
  "data": [ { "id": 10, "name": "Ceiling Fan 1200mm", "sku": "CF-1200", "category": "Appliances",
              "unitPrice": "1890.00", "currentStock": 26, "minStockAlert": 26,
              "location": "Godown 2 / Bay 5", "isActive": true, "isLowStock": true,
              "createdBy": { "id": 3, "name": "Farid Ali" },
              "createdAt": "2026-08-10T13:20:04.129Z", "updatedAt": "2026-08-10T18:35:04.751Z" } ],
  "pagination": { "page": 1, "limit": 1, "total": 10, "totalPages": 10 } }
```

`isLowStock` is computed in SQL as `current_stock <= min_stock_alert` and never stored — a stored
flag would be one more thing that can disagree with the number beside it. Note the example: 26 ≤ 26
is low stock. The threshold is inclusive.

#### `GET /api/products/categories`

Distinct categories in use, sorted, as a flat string array. Feeds the category filter dropdown
without a second full product fetch.

```jsonc
{ "success": true,
  "data": [ "Appliances", "Consumables", "Electrical", "Lighting", "Switchgear", "Tools" ] }
```

#### `GET /api/products/:id`

The single-product shape, identical to a list row.

#### `POST /api/products` → 201

| Field | Required | Rule |
| --- | --- | --- |
| `name` | ✅ | 2–150 chars |
| `sku` | ✅ | 2–50 chars, `[A-Za-z0-9_-]` only, stored **upper-cased** so `cw-25` and `CW-25` cannot both exist |
| `category` | ✅ | 2–80 chars |
| `unitPrice` | ✅ | Number or decimal string, ≥ 0, ≤ 2 decimals, ≤ 99,999,999.99. Kept as a string all the way to `NUMERIC` |
| `location` | ✅ | 1–100 chars |
| `minStockAlert` | — | Integer 0–1,000,000, default `0` |
| `openingStock` | — | Integer 0–1,000,000, default `0` |
| `currentStock` | ✖ | **Rejected** — see below |

```jsonc
// request
{ "name": "Halogen Floodlight 150W", "sku": "hal-fl-150", "category": "Lighting",
  "unitPrice": "890.50", "minStockAlert": 10, "location": "Godown 2 / Bay 1",
  "openingStock": 40 }

// 201
{ "success": true,
  "data": { "id": 25, "name": "Halogen Floodlight 150W", "sku": "HAL-FL-150",
            "category": "Lighting", "unitPrice": "890.50", "currentStock": 40,
            "minStockAlert": 10, "location": "Godown 2 / Bay 1", "isActive": true,
            "isLowStock": false, "createdBy": { "id": 1, "name": "Asha Menon" },
            "createdAt": "2026-08-11T13:34:31.449Z", "updatedAt": "2026-08-11T13:34:31.449Z" } }
```

A non-zero `openingStock` writes an `IN` movement with reason **"Opening stock"** in the same
transaction. Stock never appears from nowhere: every unit in `currentStock` is explained by a row in
the ledger. Duplicate SKU → 409 `DUPLICATE_SKU`.

#### `PUT /api/products/:id`

Full replacement of `name`, `sku`, `category`, `unitPrice`, `minStockAlert`, `location`.
`currentStock` is **not** editable here — sending it is a 422:

```jsonc
{ "success": false, "error": { "code": "VALIDATION_ERROR", "message": "Request validation failed.",
  "details": [ { "field": "body.currentStock",
                 "message": "currentStock cannot be edited directly. Record a stock movement instead." } ] } }
```

Unknown fields are normally stripped, which would have made a `currentStock` edit look like it
worked. Declaring the field purely to reject it teaches the caller the rule instead of silently
discarding their change.

Editing a product does **not** rewrite challans that already reference it — line items carry a
snapshot (see [§6 Challans](#challans)).

#### `PATCH /api/products/:id/status`

```jsonc
// request
{ "isActive": false }
```

Returns the full product. A deactivated product is hidden from the default product list and cannot
be put on a challan; its history and stock figure are untouched. This is the alternative to deleting
a product that has ledger rows behind it.

#### `GET /api/products/:id/movements`

The ledger for one product, newest first. Accepts every filter from
[`GET /api/stock-movements`](#get-apistock-movements) except `productId`, which the path supplies.

```jsonc
{ "success": true,
  "data": [ { "id": 1, "productId": 1, "productName": "Copper Wire 2.5mm (100m)",
              "productSku": "CW-25-100M", "movementType": "IN", "quantity": 120,
              "reason": "Opening stock", "balanceAfter": 120, "referenceType": "MANUAL",
              "referenceId": null, "createdBy": { "id": 3, "name": "Farid Ali" },
              "createdAt": "2026-08-10T13:20:04.129Z" } ],
  "pagination": { "page": 1, "limit": 2, "total": 1, "totalPages": 1 } }
```

---

### Stock movements

The ledger is **append-only**. There is no update and no delete: a mistake is corrected by recording
the opposite movement, which leaves both entries visible. `balanceAfter` is stamped at write time, so
the stock level at any past moment can be read straight off the row rather than recomputed.

#### `GET /api/stock-movements`

| Parameter | Values |
| --- | --- |
| `productId` | positive integer |
| `movementType` | `IN` \| `OUT` |
| `referenceType` | `MANUAL` \| `SALES_CHALLAN` |
| `createdBy` | user id |
| `dateFrom`, `dateTo` | `YYYY-MM-DD`; `dateFrom` must be ≤ `dateTo`, else 422 |

```jsonc
{ "success": true,
  "data": [ { "id": 32, "productId": 9, "productName": "Distribution Box 8-Way",
              "productSku": "DB-8W", "movementType": "OUT", "quantity": 2,
              "reason": "Sales challan CH-2026-000002", "balanceAfter": 38,
              "referenceType": "SALES_CHALLAN", "referenceId": 10,
              "createdBy": { "id": 1, "name": "Asha Menon" },
              "createdAt": "2026-08-11T04:38:48.056Z" } ],
  "pagination": { "page": 1, "limit": 2, "total": 10, "totalPages": 5 } }
```

`referenceType: "SALES_CHALLAN"` with `referenceId: 10` means the row was written by confirming
challan 10 — every automatic deduction is traceable back to the document that caused it.

#### `POST /api/stock-movements` → 201 — ADMIN, WAREHOUSE

```jsonc
// request
{ "productId": 25, "movementType": "OUT", "quantity": 3, "reason": "Damaged during handling" }

// 201
{ "success": true,
  "data": { "id": 34, "productId": 25, "productName": "Halogen Floodlight 150W",
            "productSku": "HAL-FL-150", "movementType": "OUT", "quantity": 3,
            "reason": "Damaged during handling", "balanceAfter": 37,
            "referenceType": "MANUAL", "referenceId": null,
            "createdBy": { "id": 1, "name": "Asha Menon" },
            "createdAt": "2026-08-11T13:34:47.071Z" } }
```

`reason` is mandatory (3–255 chars): every stock change must still be explainable months later.
`quantity` must be a positive integer ≤ 1,000,000 — direction is carried by `movementType`, never by
a negative number.

The write runs in a transaction: lock the product row (`SELECT … FOR UPDATE`), verify
`currentStock >= quantity` for an `OUT`, update the stock, insert the movement with `balanceAfter`.

| Outcome | Status | `code` |
| --- | --- | --- |
| `OUT` exceeds stock | 409 | `INSUFFICIENT_STOCK` |
| Unknown `productId` | 404 | `NOT_FOUND` |
| `quantity <= 0`, missing `reason`, bad enum | 422 | `VALIDATION_ERROR` |

```jsonc
// 409
{ "success": false, "error": { "code": "INSUFFICIENT_STOCK",
  "message": "Insufficient stock for Copper Wire 2.5mm (100m). Available: 120, Requested: 999999.",
  "details": [ { "field": "body.quantity", "message": "Only 120 in stock" } ] } }
```

---

### Challans

Three rules define this module:

1. A `DRAFT` never touches stock. It is a proposal, freely editable.
2. Confirming deducts stock for every line **atomically** — all of them or none — and writes one
   `OUT` movement per line.
3. Line items carry a **snapshot** of the product (name, SKU, unit price), so a later rename or
   reprice cannot rewrite a document that has already been dispatched.

**Shapes.** List endpoints return the *summary*: header fields plus `itemCount`, without `items`.
Detail endpoints (`GET /:id`, and everything that returns the challan after a write) return the same
fields **plus** `items`.

#### `GET /api/challans`

| Parameter | Values |
| --- | --- |
| `search` | Matches the challan number |
| `status` | `DRAFT` \| `CONFIRMED` \| `CANCELLED` |
| `customerId`, `createdBy` | positive integer |
| `dateFrom`, `dateTo` | `YYYY-MM-DD`, `dateFrom` ≤ `dateTo` |
| `sortBy` | `createdAt` \| `challanNumber` \| `totalAmount` \| `status` |

```jsonc
{ "success": true,
  "data": [ { "id": 10, "challanNumber": "CH-2026-000002",
              "customer": { "id": 6, "name": "Anjali Rao", "businessName": "Rao Distribution House",
                            "mobile": "9090909090", "gstNumber": "29AAECR4567L1ZP" },
              "status": "CONFIRMED", "totalQuantity": 2, "totalAmount": "4300.00",
              "notes": "Phase 6 dashboard verification - confirmed", "itemCount": 1,
              "createdBy":   { "id": 1, "name": "Asha Menon" },
              "confirmedBy": { "id": 1, "name": "Asha Menon" },
              "cancelledBy": null,
              "createdAt": "2026-08-11T04:38:48.056Z",
              "confirmedAt": "2026-08-11T04:38:48.056Z",
              "cancelledAt": null, "updatedAt": "2026-08-11T04:38:48.056Z" } ],
  "pagination": { "page": 1, "limit": 1, "total": 2, "totalPages": 2 } }
```

#### `GET /api/challans/:id`

```jsonc
{ "success": true,
  "data": { "id": 11, "challanNumber": "CH-2026-000003",
            "customer": { "id": 19, "name": "Priya Nair", "businessName": "Nair Enterprises",
                          "mobile": "919845011223", "gstNumber": "29AABCN7654P1Z3" },
            "status": "CONFIRMED", "totalQuantity": 6, "totalAmount": "5343.00",
            "notes": "Revised: floodlights only.", "itemCount": 1,
            "createdBy":   { "id": 1, "name": "Asha Menon" },
            "confirmedBy": { "id": 1, "name": "Asha Menon" },
            "cancelledBy": null,
            "createdAt":   "2026-08-11T13:34:47.234Z",
            "confirmedAt": "2026-08-11T13:34:57.920Z",
            "cancelledAt": null, "updatedAt": "2026-08-11T13:34:57.920Z",
            "items": [ { "id": 17, "productId": 25,
                         "productName": "Halogen Floodlight 150W", "productSku": "HAL-FL-150",
                         "unitPrice": "890.50", "quantity": 6, "lineTotal": "5343.00",
                         "availableStock": 31 } ] } }
```

`productName`, `productSku` and `unitPrice` come from the **snapshot columns**, so this response is
identical a year later even if the product has been renamed and repriced. `availableStock` is the
live figure joined in for the UI — it is deliberately *not* part of the snapshot, because "what this
sold for" and "what is on the shelf right now" are different questions.

#### `POST /api/challans` → 201 — ADMIN, SALES

```jsonc
{ "customerId": 19,
  "items": [ { "productId": 25, "quantity": 4 },
             { "productId": 1,  "quantity": 10 } ],
  "notes": "Deliver to the Bengaluru godown.",
  "confirmImmediately": false }
```

| Rule | Behaviour |
| --- | --- |
| `items` | 1–100 lines, every `quantity` a positive integer ≤ 1,000,000 |
| Duplicate `productId` | 422 — *"This product is already on line 1. Combine the quantities instead."* Silently summing would hide a data-entry mistake, and the table has a `UNIQUE (challan_id, product_id)` constraint anyway |
| `notes` | Optional, ≤ 1000 chars |
| Prices | **Never sent by the client.** Name, SKU and unit price are read from the products table server-side, so a caller cannot decide what something sold for |
| Customer must exist | 404 if absent or soft-deleted |
| Customer must not be `INACTIVE` | 409 `INVALID_STATE`. A `LEAD` is allowed — a first order is exactly how a lead becomes a customer |
| Products must exist and be active | 409 `INVALID_STATE`, listing every bad line at once |

Challan numbers are issued server-side in the format `CH-<year>-<6 digits>` (`CH-2026-000003`).

**`confirmImmediately: true`** runs the create *and* the confirmation in one transaction — the
"Save & Confirm" button on the create screen. On insufficient stock nothing is written at all, not
even the draft:

```jsonc
// 409 — and no challan row is left behind
{ "success": false, "error": { "code": "INSUFFICIENT_STOCK",
  "message": "Insufficient stock for Aluminium Ladder 8ft. Available: 0, Requested: 99.",
  "details": [ { "field": "items[1].quantity",
                 "message": "Aluminium Ladder 8ft (ALU-LDR-8) — available 0, requested 99" } ] } }
```

#### `PUT /api/challans/:id`

Replaces a **draft's** `customerId`, `items` and `notes` — same validation as create, minus
`confirmImmediately`. Items are replaced wholesale, not merged. Editing a `CONFIRMED` or `CANCELLED`
challan is 409:

```jsonc
{ "success": false, "error": { "code": "INVALID_STATE",
  "message": "Challan CH-2026-000003 is confirmed and can no longer be edited." } }
```

#### `POST /api/challans/:id/confirm` → 200 — the critical endpoint

No request body. ADMIN, SALES **and WAREHOUSE** — confirmation is the moment goods physically leave,
which is a warehouse act. One transaction:

1. `SELECT … FOR UPDATE` the challan → 404 if absent, 409 `INVALID_STATE` if not `DRAFT`.
2. 409 `INVALID_STATE` if it has no items.
3. `SELECT … FOR UPDATE` every referenced product, **ordered by product id**, so two concurrent
   confirmations acquire locks in the same sequence and cannot deadlock by grabbing them in opposite
   orders.
4. Check `currentStock >= quantity` for **every** line before changing anything, collecting all
   shortfalls.
5. On any shortfall → `ROLLBACK`, and return **every** failing line in `details` so the user fixes
   the whole challan in one pass instead of discovering shortfalls one at a time.
6. Otherwise: decrement each product, insert one `OUT` movement per line with
   `referenceType: "SALES_CHALLAN"` and `referenceId` = the challan id, refresh each line's snapshot
   from the locked row, recompute the totals, set `status = "CONFIRMED"` with `confirmedBy` /
   `confirmedAt`, `COMMIT`.

The `products.current_stock >= 0` check constraint is the backstop: if the service logic were ever
wrong, the transaction aborts rather than persisting negative stock.

| Outcome | Status | `code` | Message |
| --- | --- | --- | --- |
| Already confirmed | 409 | `INVALID_STATE` | `"Challan CH-2026-000003 has already been confirmed."` |
| Cancelled | 409 | `INVALID_STATE` | `"Challan CH-2026-000004 was cancelled and cannot be confirmed."` |
| Shortfall | 409 | `INSUFFICIENT_STOCK` | `"Insufficient stock for <product>. Available: N, Requested: M."` |

Returns the full challan detail with `status: "CONFIRMED"`.

#### `POST /api/challans/:id/cancel` → 200

```jsonc
{ "reason": "Customer withdrew the order" }
```

`reason` is optional (≤ 255 chars); an empty body is accepted. The reason is appended to the notes
(`"…\n\nCancelled: Customer withdrew the order"`) so the document explains itself.

Only legal from `DRAFT`. Cancelling a `CONFIRMED` challan is 409 `INVALID_STATE` — *"…its stock has
already been dispatched. Record a stock return instead of cancelling."* Silently adding stock back
would let anyone inflate inventory by confirming and cancelling in a loop. No stock is touched by a
cancellation, because a draft never reserved any.

---

### Dashboard

#### `GET /api/dashboard/summary`

Every number is a live aggregate query — nothing is cached or denormalised. Each list carries at most
5 rows: the dashboard is a glance, and every panel links to the full list.

```jsonc
{ "success": true,
  "data": {
    "customers": { "total": 7, "active": 4, "leads": 2, "followUpsDue": 3 },
    "products":  { "total": 10, "lowStock": 4, "outOfStock": 1, "inactive": 0 },
    "challans":  { "total": 2, "draft": 1, "confirmed": 1, "cancelled": 0,
                   "confirmedThisMonth": 1, "valueThisMonth": "4300.00" },
    "lowStockProducts": [ { "id": 5, "name": "MCB 32A Single Pole", "sku": "MCB-32-SP",
                            "currentStock": 8, "minStockAlert": 30 } ],
    "recentChallans":   [ { "id": 10, "challanNumber": "CH-2026-000002",
                            "customerName": "Rao Distribution House", "status": "CONFIRMED",
                            "totalAmount": "4300.00", "createdAt": "2026-08-11T04:38:48.056Z" } ],
    "recentMovements":  [ { "id": 32, "productId": 9, "productName": "Distribution Box 8-Way",
                            "movementType": "OUT", "quantity": 2, "balanceAfter": 38,
                            "createdAt": "2026-08-11T04:38:48.056Z" } ] } }
```

Definitions that are easy to misread:

- `outOfStock` is a **subset** of `lowStock`, not a separate population. Both count active products
  only.
- `followUpsDue` counts non-deleted customers whose `followUpDate <= CURRENT_DATE`.
- `confirmedThisMonth` and `valueThisMonth` are measured on `confirmedAt`, so a challan drafted last
  month and confirmed this month belongs to **this** month.

Full per-field definitions are in [FRONTEND_GUIDE.md](./FRONTEND_GUIDE.md) §2.2.

---

## 7. Permission matrix

Enforced by `backend/src/config/permissions.ts` — the same named groups the routes reference, so this
table can be checked against real code rather than a promise.

| Capability | ADMIN | SALES | WAREHOUSE | ACCOUNTS |
| --- | :---: | :---: | :---: | :---: |
| Read customers | ✅ | ✅ | ✅ | ✅ |
| Create / edit customers | ✅ | ✅ | ✖ | ✖ |
| Delete customers | ✅ | ✖ | ✖ | ✖ |
| Read follow-ups | ✅ | ✅ | ✖ | ✅ |
| Add follow-ups | ✅ | ✅ | ✖ | ✖ |
| Read products & stock ledger | ✅ | ✅ | ✅ | ✅ |
| Create / edit products, toggle status | ✅ | ✖ | ✅ | ✖ |
| Record manual stock movements | ✅ | ✖ | ✅ | ✖ |
| Read challans | ✅ | ✅ | ✅ | ✅ |
| Create / edit challans | ✅ | ✅ | ✖ | ✖ |
| **Confirm** a challan | ✅ | ✅ | ✅ | ✖ |
| Cancel a challan | ✅ | ✅ | ✖ | ✖ |
| Dashboard | ✅ | ✅ | ✅ | ✅ |
| List users | ✅ | ✖ | ✖ | ✖ |

Two lines carry the reasoning of the whole matrix: **Warehouse can confirm but not create** a challan
(they dispatch goods, they do not sell them), and **Sales can read stock but not change it** (they
must see what is available before promising a delivery, but a stock figure is the warehouse's word).
Rationale for each group is in [AUTHENTICATION.md](./AUTHENTICATION.md).

---

## 8. Postman collection

`postman/` — 9 folders, **56 requests, 144 assertions**. See
[postman/README.md](../postman/README.md) for the full walkthrough.

1. Import `Mini-ERP-CRM.postman_collection.json` and `Mini-ERP-CRM.postman_environment.json`.
2. Select the **Mini ERP + CRM — Local** environment.
3. Run **Auth → Login (admin)**. A test script writes `token` into the environment and
   collection-level auth applies it to every other request — nothing is pasted by hand.
4. Run anything else, or **Run collection** for all 56.

The **Workflow (end-to-end)** folder is the demo path: create a customer, create a product with 50
opening stock, raise a draft for 12 units (asserting stock is *still 50*, because a draft never
touches stock), confirm it, then re-read the product (38) and the ledger entry that explains the
difference. Each step saves the id it created, so the folder runs top to bottom unedited.

**Errors (these fail on purpose)** covers 400, 401, 403, 404, 409 and 422. Its tests assert the
failures, so a green run means the error contract in [§4](#4-errors) holds — the contract is
demonstrable rather than merely described.

`baseUrl` defaults to `http://localhost:4000/api`; point it at the deployed URL to run the same
collection against production. `rootUrl` is the same host without the `/api` suffix and is used only
by the service-banner request, since `GET /` is the one route outside the prefix.

Both files are generated by `postman/build-collection.mjs` — edit the script, not the JSON — and were
verified with `newman`, passing with 0 failures on a clean run and again on an immediate second run
(requests that would trip a unique constraint generate a timestamped mobile and SKU).

---

## 9. Rate limits, CORS and other operational notes

- **No rate limiting.** The API is an internal tool behind authentication, and the case study does
  not call for it. It would be the first thing to add before any public exposure.
- **CORS** allows only the origins in `CORS_ORIGINS` (default `http://localhost:5173`). A rejected
  origin gets a 403 with `FORBIDDEN`, not a silent failure. A request with **no** `Origin` header —
  curl, Postman, a health probe — is allowed, because CORS exists to constrain browsers.
- **Security headers** come from `helmet()`. `X-Powered-By` is disabled.
- **Body limit** 100 kB, which is far more than any endpoint needs and puts a ceiling on how much
  memory an unauthenticated caller can make the process allocate.
- **Logging** is `morgan` → the app logger; `GET /api/health` is skipped. 5xx responses log a stack
  trace, 4xx log a single warn line — a client being told "no" is normal traffic, not an incident.

---

## 10. Status code summary

| Code | Used for |
| --- | --- |
| 200 | Successful read, update, confirm, cancel, status change |
| 201 | Created — customers, follow-ups, products, stock movements, challans |
| 204 | `DELETE /api/customers/:id` only. No body |
| 400 | Malformed JSON, or a non-numeric `:id` |
| 401 | Not authenticated / bad credentials / expired token |
| 403 | Authenticated but not permitted; also a rejected CORS origin |
| 404 | Unknown or soft-deleted resource, unknown route |
| 409 | Duplicate, illegal state transition, insufficient stock |
| 413 | Body over 100 kB |
| 422 | Schema validation failure |
| 500 | Unexpected server error (generic message) |
| 503 | Database unreachable — also `GET /api/health` reporting a degraded system |

---

## 11. Differences from the Phase 0 plan

[API_PLAN.md](./API_PLAN.md) is the design agreed before any handler was written. It is left
unedited as a record of that decision; this section is the honest diff.

| # | Plan | Implementation | Why |
| --- | --- | --- | --- |
| 1 | 26 endpoints | **29** | `GET /` (deploy banner), `GET /api/users` (Admin-only staff list, needed by the "created by" filters), `GET /api/products/categories` (populates the category dropdown without fetching every product) |
| 2 | Challan detail returns header + items | Also returns `itemCount`, `updatedAt`, and `availableStock` per line | The list and detail screens needed them; adding a field is backwards-compatible |
| 3 | Login returns `user { id, name, email, role }` | Also `isActive`, `createdAt` | Same user shape is reused by `/auth/me` and `/users`, rather than three near-identical DTOs |
| 4 | `POST /challans` validation errors use `items[i]` field paths | Create/update use `body.items.i.productId`; **confirm** uses `items[i].quantity` | The first comes from the Zod validator (which prefixes the request part), the second from the service. Both are stable, but they are not the same convention — worth knowing when writing a client that maps errors onto form fields |
| 5 | 415 `UNSUPPORTED_MEDIA_TYPE` for a non-JSON body | **Not reachable in practice** | Express's JSON parser ignores a body whose `Content-Type` is not JSON rather than rejecting it, so the request arrives with no body and fails schema validation as a **422** instead. The code and its handler branch exist; no current route produces it |
| 6 | `GET /api/customers/:id/challans` inherits the customer list filters | `page` and `limit` only | It reuses the follow-up pagination schema. A customer's challan history is short; the full challan list with `?customerId=` covers the filtered case |

---

*Phase 8 deliverable. Deploying this API: [DEPLOYMENT.md](./DEPLOYMENT.md). Exercising it:
[postman/](../postman/).*
