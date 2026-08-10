# Customer CRM Module

> Phase 3 deliverable. Customer master data, search and filtering, and the follow-up note history.
> Related: [API_PLAN.md](./API_PLAN.md) · [DATABASE_DESIGN.md](./DATABASE_DESIGN.md) · [AUTHENTICATION.md](./AUTHENTICATION.md)

---

## 1. What the module does

A shared customer book for the sales team. It replaces the personal phones and spreadsheets that
customer details normally live in, and answers the question a small distributor asks every morning:
*who am I supposed to call today?*

Three things make it a CRM rather than a contact list:

1. **Status** — a customer moves `LEAD → ACTIVE → INACTIVE`, so the pipeline is visible.
2. **Follow-up date** — a single date field the whole team can see and sort by, with overdue dates
   highlighted in red.
3. **Follow-up history** — an append-only log of what was discussed, by whom, and when.

---

## 2. Customer workflow

```text
Sales adds a customer                     status = LEAD
        │                                 follow-up date = when to call back
        │
        ├── logs a follow-up note ────►   "Called about the 200-unit order.
        │        │                         Will confirm Monday."
        │        │                         + next follow-up date (optional)
        │        │
        │        └── if a next date is given, the customer's own follow_up_date
        │            moves to match — in the SAME transaction, so the list view
        │            and the note history can never disagree
        │
        ├── deal won  ─────────────────►  status = ACTIVE   (can be used on challans)
        ├── goes quiet ────────────────►  status = INACTIVE
        │
        └── Admin deletes ─────────────►  soft delete: the row survives so historical
                                          challans keep a valid customer, and the mobile
                                          number becomes available again
```

---

## 3. Data model

Tables `customers` and `customer_follow_ups` — full column-level detail in
[DATABASE_DESIGN.md §3.2 and §3.3](./DATABASE_DESIGN.md).

| Field | Type | Required | Notes |
| --- | --- | :---: | --- |
| `name` | text 2–120 | ✔ | Contact person |
| `mobile` | 10–15 digits | ✔ | **Unique among live customers**; the practical business key |
| `email` | email | ✔ | Not unique — a business may share one mailbox |
| `businessName` | text 2–150 | ✔ | |
| `gstNumber` | 15-char GSTIN | ✖ | Format-checked only; no checksum or government lookup |
| `customerType` | `RETAIL` \| `WHOLESALE` \| `DISTRIBUTOR` | ✔ | |
| `address` | text 5–500 | ✔ | |
| `status` | `LEAD` \| `ACTIVE` \| `INACTIVE` | ✔ | Defaults to `LEAD` |
| `followUpDate` | date | ✖ | Calendar day — no time, no timezone |
| `notes` | text ≤ 2000 | ✖ | Standing notes about the account |

**Why `notes` and follow-ups are both present.** `customers.notes` is a standing description of the
account ("prefers delivery before noon"). A follow-up is an *event* — it has an author and a
timestamp. Appending events into one text column would lose both, and make "who called them last?"
unanswerable.

### Two schema decisions made in this phase

**Mobile uniqueness is partial.** Migration `002` replaced `UNIQUE (mobile)` with:

```sql
CREATE UNIQUE INDEX uq_customers_mobile_active ON customers (mobile) WHERE deleted_at IS NULL;
```

The original constraint combined badly with soft deletion: the deleted row kept holding the number,
so it could never be registered again. Worse, the service-layer duplicate check *did* ignore deleted
rows, so the two layers disagreed — the service approved an insert the database then rejected.

**Dates are strings end to end.** `pg` parses a `DATE` column into a JS `Date` at *local* midnight.
Serialising that to UTC shifts the day for any positive offset — in IST (+05:30) the stored
`2026-08-14` would leave the API as `2026-08-13T18:30:00Z`, and every follow-up would appear a day
early. `config/db.ts` therefore registers a type parser for OID 1082 that returns the raw
`'YYYY-MM-DD'` string. `TIMESTAMPTZ` is left alone — that genuinely is an instant.

---

## 4. API endpoints

All require `Authorization: Bearer <token>`.

| Method | Path | Roles | Purpose |
| --- | --- | --- | --- |
| `GET` | `/api/customers` | All | List with search, filters, sort, pagination |
| `POST` | `/api/customers` | Admin, Sales | Create |
| `GET` | `/api/customers/:id` | All | Detail |
| `PUT` | `/api/customers/:id` | Admin, Sales | Full update |
| `DELETE` | `/api/customers/:id` | **Admin** | Soft delete → `204` |
| `GET` | `/api/customers/:id/follow-ups` | Admin, Sales, Accounts | History, newest first |
| `POST` | `/api/customers/:id/follow-ups` | Admin, Sales | Add a note → `201` |

`GET /api/customers/:id/challans` is deferred to Phase 5, when challans exist.

### Query parameters on `GET /api/customers`

| Parameter | Values | Default |
| --- | --- | --- |
| `page` | integer ≥ 1 | `1` |
| `limit` | 1–100 | `20` |
| `search` | matches `name`, `businessName`, `mobile`, `email` (case-insensitive, partial) | — |
| `status` | `LEAD` \| `ACTIVE` \| `INACTIVE` | — |
| `customerType` | `RETAIL` \| `WHOLESALE` \| `DISTRIBUTOR` | — |
| `followUpBefore` | `YYYY-MM-DD` — follow-ups due on or before this date | — |
| `sortBy` | `createdAt` \| `name` \| `businessName` \| `followUpDate` | `createdAt` |
| `sortOrder` | `asc` \| `desc` | `desc` |

`sortBy` is mapped through a whitelist to a real column name. A sort key cannot be a bound
parameter — it is an identifier — so this map is what keeps request input out of the SQL string. An
unrecognised key silently falls back to the default.

Sorting by `followUpDate` uses `NULLS LAST`, so customers with no date scheduled sink to the bottom
instead of burying the ones that actually need a call.

### Example

```jsonc
// GET /api/customers?search=sharma&status=ACTIVE&page=1&limit=10
{
  "success": true,
  "data": [
    { "id": 1, "name": "Ramesh Patel", "mobile": "9876543210",
      "email": "ramesh@sharmatraders.in", "businessName": "Sharma Traders",
      "gstNumber": "24AAACS1234F1Z5", "customerType": "WHOLESALE",
      "address": "14 MG Road, Ring Road Market, Surat, Gujarat 395003",
      "status": "ACTIVE", "followUpDate": "2026-08-14",
      "notes": "Prefers delivery before noon. Pays on 30-day terms.",
      "createdBy": { "id": 1, "name": "Asha Menon" },
      "createdAt": "2026-08-10T13:20:04.995Z", "updatedAt": "2026-08-10T13:20:04.995Z" }
  ],
  "pagination": { "page": 1, "limit": 10, "total": 1, "totalPages": 1 }
}
```

---

## 5. Validation

Enforced by Zod before the controller runs; the database `CHECK` constraints remain the backstop.

| Field | Rule | On failure |
| --- | --- | --- |
| `name` | trimmed, 2–120 chars | 422 |
| `mobile` | punctuation (` `, `+`, `-`, `()`) stripped, then 10–15 digits | 422 |
| `email` | valid address, lower-cased, ≤ 254 chars | 422 |
| `businessName` | trimmed, 2–150 | 422 |
| `gstNumber` | optional; upper-cased, must match the 15-char GSTIN pattern | 422 |
| `customerType` | strict enum | 422 |
| `address` | trimmed, 5–500 | 422 |
| `status` | strict enum, defaults to `LEAD` | 422 |
| `followUpDate` | `YYYY-MM-DD`, must be a real calendar day (rejects `2026-02-31`) | 422 |
| `notes` | optional, ≤ 2000 | 422 |
| `:id` | positive integer | **400** |
| Duplicate mobile | checked against live customers | **409 `DUPLICATE_MOBILE`** |

**Input is normalised, not just rejected.** `"+91 98111 22333"` is stored as `919811122333`,
`"Deepak@JoshiElectric.IN"` as `deepak@joshielectric.in`, and `"27aacce1234f1z9"` as
`"27AACCE1234F1Z9"`. Rejecting a phone number because someone typed a space would be pedantry, not
validation.

**Empty strings mean "not provided."** HTML forms submit `""` for untouched optional inputs. A
`preprocess` step converts blank strings to `undefined`, so an empty GST or date is stored as `NULL`
rather than failing a format check.

**Every problem is reported at once.** Body, params and query are all parsed in a single pass, so a
form with seven bad fields returns seven `details` entries — not one per round trip.

**400 vs 422.** A bad path parameter (`/customers/abc`) is a 400: the URL is not a resource address
at all. A well-formed request whose body fails a rule is a 422. This is the contract published in
`API_PLAN.md §1`.

---

## 6. Role access

| Action | Admin | Sales | Warehouse | Accounts |
| --- | :---: | :---: | :---: | :---: |
| List / search / view | ✔ | ✔ | ✔ (read) | ✔ (read) |
| Create / edit | ✔ | ✔ | ✖ | ✖ |
| Delete | ✔ | ✖ | ✖ | ✖ |
| View follow-ups | ✔ | ✔ | ✖ | ✔ |
| Add follow-up | ✔ | ✔ | ✖ | ✖ |

Warehouse can see who a dispatch is for, but has no reason to work the sales pipeline — hence
read-only on customers and no follow-up access at all. Accounts can read follow-ups because payment
conversations are logged there.

Enforced by `authorize(CUSTOMER_READ | CUSTOMER_WRITE | CUSTOMER_DELETE | FOLLOW_UP_READ |
FOLLOW_UP_WRITE)` from `config/permissions.ts`.

---

## 7. Frontend

| Screen | Route | Notes |
| --- | --- | --- |
| Customer list | `/customers` | Search, status and type filters, pagination, overdue highlighting |
| Customer detail | `/customers/:id` | Full record, follow-up timeline, add-note form, delete |
| Add customer | `/customers/new` | Admin & Sales only (`RoleRoute`) |
| Edit customer | `/customers/:id/edit` | Admin & Sales only |

**Filters live in the URL.** `/customers?search=sharma&status=ACTIVE&page=2` is a real address — it
can be bookmarked, shared with a colleague, and the browser back button works through filter changes.
Holding that state in `useState` would have thrown it away on every navigation.

**Search is debounced (350 ms).** Without it, typing "distributor" fires eleven requests whose
answers can arrive out of order. `useApi` additionally tracks a request id and discards any response
that is no longer the latest.

**One form component for add and edit.** The presence of `:id` decides whether it loads an existing
record and `PUT`s, or starts blank and `POST`s — so the two can never drift apart in fields,
validation or layout.

**Server field errors map back onto inputs.** A 422 returns `details` like
`{ field: "body.mobile", message: "…" }`; the form strips the `body.` prefix and attaches each
message to its input, so a server-side rejection looks identical to a client-side one.

**Every screen renders four states** — loading, error (with retry), empty (with a different message
depending on whether filters are active), and success.

**Role-aware UI.** "Add customer" and "Edit" appear only for Admin and Sales; "Delete" only for
Admin; the follow-up form only for roles that may write one. All cosmetic — the API enforces the
same rules independently.

---

## 8. Test results

Executed against the running API on 2026-08-10.

### List, search, filter, sort

| # | Case | Expected | Actual | ✓ |
| --- | --- | --- | --- | --- |
| 1 | `?page=1&limit=3` | 3 rows, total 7, 3 pages | as expected | ✅ |
| 2 | `?search=sharma` | 1 match | Sharma Traders | ✅ |
| 3 | `?status=LEAD` | only LEAD rows | 2 rows, all LEAD | ✅ |
| 4 | `?customerType=DISTRIBUTOR` | 2 rows | 2 | ✅ |
| 5 | `?sortBy=name&sortOrder=asc` | alphabetical | Anjali, Imran, Kavita | ✅ |
| 6 | `?status=NOPE&limit=999` | 422, both problems | 422 listing both | ✅ |

### CRUD

| # | Case | Expected | Actual | ✓ |
| --- | --- | --- | --- | --- |
| 7 | Create with `"+91 98111 22333"` | 201, digits stored | `919811122333` | ✅ |
| 8 | Mixed-case email and GST | normalised | `deepak@joshielectric.in`, `27AACCE1234F1Z9` | ✅ |
| 9 | `createdBy` attribution | signed-in user | Nikhil Rao (Sales) | ✅ |
| 10 | Duplicate mobile | 409 | `DUPLICATE_MOBILE` | ✅ |
| 11 | Seven invalid fields at once | 422 listing all | all 7 returned | ✅ |
| 12 | `GET /customers/999999` | 404 | `NOT_FOUND` | ✅ |
| 13 | `GET /customers/abc` | **400** | `BAD_REQUEST` | ✅ |
| 14 | Update status and type | 200 | LEAD→ACTIVE, RETAIL→WHOLESALE | ✅ |
| 15 | `updated_at` trigger | differs from `created_at` | it does | ✅ |
| 16 | Follow-up date not shifted | `2026-08-14` | `2026-08-14` | ✅ |

### Follow-ups

| # | Case | Expected | Actual | ✓ |
| --- | --- | --- | --- | --- |
| 17 | Add note with next date | 201 | id 1, by Nikhil Rao | ✅ |
| 18 | Add note without a date | 201, null | `null` | ✅ |
| 19 | History ordering | newest first | newest first | ✅ |
| 20 | **SVC9** — customer date syncs to note | `2026-09-21` | `2026-09-21` | ✅ |

### Authorization and deletion

| # | Case | Expected | Actual | ✓ |
| --- | --- | --- | --- | --- |
| 21 | List as all four roles | 200 ×4 | 200 ×4 | ✅ |
| 22 | Create as Warehouse / Accounts | 403 | 403 both | ✅ |
| 23 | Update as Warehouse / Accounts | 403 | 403 both | ✅ |
| 24 | Follow-ups as Warehouse | 403 | 403 | ✅ |
| 25 | Follow-ups as Accounts | 200 | 200 | ✅ |
| 26 | Delete as Sales | 403 | 403 | ✅ |
| 27 | Delete as Admin | 204 | 204 | ✅ |
| 28 | Read after delete | 404 | 404 | ✅ |
| 29 | Deleted row hidden from list | total back to 7 | 7 | ✅ |
| 30 | Reuse a deleted customer's mobile | 201 | 201 (after migration 002) | ✅ |
| 31 | Duplicate against a live customer | 409 | 409 | ✅ |

**31 of 31 passed.**

---

## 9. Known limitations

1. **Search uses `ILIKE '%term%'`.** A leading wildcard cannot use a B-tree index, so this is a
   sequential scan — a few milliseconds at a small distributor's data volume. The upgrade path is
   the `pg_trgm` extension with GIN indexes; adopting it now would optimise a problem that does not
   exist.
2. **`PUT` is a full replacement.** Every field must be sent. The form always submits the complete
   record, so this only matters to direct API callers.
3. **No bulk operations** — no CSV import, no multi-select delete.
4. **No customer-level audit trail.** Follow-ups are append-only, but edits to the customer record
   itself overwrite the previous values. Stock movements get this discipline because stock is money;
   extending it to customers is listed as a future enhancement.
5. **GST validation is format-only** — the pattern is checked, the checksum is not, and there is no
   government API lookup.
6. **Deletion is not reversible from the UI.** The row is recoverable with SQL (`deleted_at = NULL`),
   but no restore screen exists.
