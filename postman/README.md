# Postman collection

Every endpoint of the Mini ERP + CRM API, with the login request wired to set the bearer token for
everything else.

| File | What it is |
| --- | --- |
| `Mini-ERP-CRM.postman_collection.json` | 9 folders, 56 requests, 144 assertions |
| `Mini-ERP-CRM.postman_environment.json` | `baseUrl`, `rootUrl`, and the ids the requests pass between each other |
| `build-collection.mjs` | Generates both files. The JSON is **not** hand-edited |

Full endpoint reference: [`docs/API_DOCUMENTATION.md`](../docs/API_DOCUMENTATION.md).

---

## Using it

1. Postman → **Import** → drag in both `.json` files.
2. Select the **Mini ERP + CRM — Local** environment (top-right).
3. Run **Auth → Login (admin)**. Its test script stores `{{token}}`; collection-level bearer auth
   applies it to every other request, so no token is ever pasted by hand.
4. Run anything else — or hit **Run collection** and watch all 56 go green.

Point `baseUrl` at a deployed URL to run the same collection against production
(`rootUrl` is the same host without the `/api` suffix — only the service-banner request uses it,
because `GET /` is the one route outside the prefix).

The backend must be running with a seeded database:

```bash
cd backend
npm run db:setup   # migrate + seed
npm run dev
```

## The folders

| Folder | Notes |
| --- | --- |
| **System** | `GET /` and `GET /api/health`. Neither needs a token |
| **Auth** | Login as admin / sales / warehouse (each stores its own token), current user, user list |
| **Customers** | CRM CRUD, follow-ups, a customer's challans, and a soft delete on a throwaway record |
| **Products** | Product master, categories, status toggle, per-product ledger |
| **Stock movements** | The global ledger and a manual `OUT` |
| **Challans** | Draft → confirm, draft → cancel, and create-and-confirm in one call |
| **Dashboard** | The summary endpoint |
| **Workflow (end-to-end)** | The demo path — see below |
| **Errors (these fail on purpose)** | The documented 4xx contract |

### Workflow (end-to-end)

The folder to open first. It runs the whole story and asserts the part that matters:

1. Log in
2. Create a customer
3. Create a product with **50** opening stock
4. Raise a draft challan for **12** units — and assert stock is *still 50*, because a draft never
   touches stock
5. Confirm it
6. Re-read the product — **38**
7. Read the ledger — an `OUT` of 12, `balanceAfter: 38`, `referenceType: SALES_CHALLAN`, pointing at
   the challan that caused it
8. Confirm again — **409**, because confirmation is not idempotent

Each step saves the id it created, so the folder runs top to bottom with no editing.

### Errors (these fail on purpose)

Every request in this folder is *meant* to fail, and its tests assert the failure — a green run
means the error contract holds. It covers 400, 401 (×2), 403, 404, 409 (×3) and 422 (×4), including
the two rules that are easiest to get wrong: `currentStock` cannot be edited through the product
route, and the same product cannot appear twice on one challan.

---

## Re-runnability

Requests that would otherwise trip a unique constraint generate a timestamped mobile number and SKU
in a pre-request script, so the collection can be run repeatedly against the same database without
`DUPLICATE_MOBILE` / `DUPLICATE_SKU` failures on the second pass. The delete example creates its own
throwaway customer rather than deleting the one later folders depend on.

Each full run does leave rows behind (a customer, a product, a few challans and their ledger
entries). That is deliberate — they are real records produced by real requests. Reset with:

```bash
cd backend && npm run db:setup
```

## Regenerating

```bash
node postman/build-collection.mjs
```

Edit `build-collection.mjs`, never the JSON. Then verify:

```bash
npx newman run postman/Mini-ERP-CRM.postman_collection.json \
  -e postman/Mini-ERP-CRM.postman_environment.json
```

Both committed files were produced this way and pass with **0 failures** on a clean run and again on
an immediate second run.
