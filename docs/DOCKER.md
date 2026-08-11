# Running with Docker

> The whole stack — PostgreSQL, the API and the web app — with one command and no local
> Node.js or PostgreSQL install.
>
> This is a **local demo stack**. Production is Neon + Render + Vercel; see
> [DEPLOYMENT.md](./DEPLOYMENT.md).

---

## 1. Start it

```bash
docker compose up --build
```

| | |
| --- | --- |
| App | <http://localhost:8080> |
| API | <http://localhost:4000/api/health> |
| PostgreSQL | `localhost:5433` (user `postgres`, password `postgres`, database `mini_erp_crm`) |

Sign in with any account from the README — `admin@fundsroom.local` / `Admin@12345`. The database is
migrated and seeded automatically on first start, so there is no setup step.

Stop with `Ctrl+C`, or:

```bash
docker compose down       # stop, keep the data
docker compose down -v    # stop and delete the data — the next start re-seeds
```

---

## 2. What it builds

| Service | Image | Notes |
| --- | --- | --- |
| `postgres` | `postgres:17-alpine` | Data in a named volume (`pgdata`), so it survives a restart |
| `api` | built from `backend/Dockerfile` | Multi-stage: TypeScript is compiled in the build stage; the runtime stage has only `dist/` and production dependencies |
| `web` | built from `frontend/Dockerfile` | Multi-stage: Vite builds the SPA, then **nginx** serves it. The runtime image contains no Node.js at all |

Both application images run as unprivileged users and declare health checks. The API's health check
hits its own `/api/health`, which reports database connectivity too — so a container that cannot
reach PostgreSQL is marked unhealthy rather than "running".

### Start-up order

`api` waits for `postgres` to pass `pg_isready`, because the API deliberately refuses to boot
without a reachable database. It then runs migrations, seeds, and serves — the same sequence as
Render's start command. Both steps are idempotent, so a restart re-runs them as no-ops, and a failed
migration exits the container instead of serving against an old schema.

---

## 3. The two things that are easy to get wrong

**1. `VITE_API_BASE_URL` must be a *host* address, not a service name.**

It is `http://localhost:4000/api`, not `http://api:4000/api`. Containers resolve each other by
service name, but this value is resolved by the **browser**, which lives outside the Docker network.
`http://api:4000` works from inside a container and fails in the browser every single time.

**2. It is baked in at build time.**

Vite inlines `VITE_*` variables into the bundle, so it is a Docker **build argument**. Changing it
means rebuilding the image:

```bash
docker compose up --build web
```

Restarting the container does nothing, because the value is already compiled into the JavaScript.

A third, quieter one: `CORS_ORIGINS` on the API must name the origin the browser uses
(`http://localhost:8080`). Change `WEB_PORT` and you must rebuild `web` **and** restart `api`, or
the browser gets blocked while curl keeps working.

---

## 4. Changing ports

Every port is overridable. Create a `.env` file **in the repository root** (Compose reads it
automatically) or set the variables in your shell:

```bash
WEB_PORT=3000
API_PORT=4001
POSTGRES_PORT=5544
```

Then `docker compose up --build` — the rebuild matters, because the API URL compiled into the web
bundle depends on `API_PORT`.

| Variable | Default | Why the default is what it is |
| --- | --- | --- |
| `WEB_PORT` | `8080` | Leaves 5173 free for `npm run dev` |
| `API_PORT` | `4000` | Same as local development |
| `POSTGRES_PORT` | `5433` | **Not 5432** — that is almost always taken by a local PostgreSQL install, and the clash looks like a broken container |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | `postgres` / `postgres` / `mini_erp_crm` | |
| `JWT_SECRET` | a local development value | Fine here; production generates its own (see `render.yaml`) |

---

## 5. Everyday commands

```bash
docker compose logs -f api           # follow the API logs
docker compose ps                    # health status of each service
docker compose exec api sh           # shell into the API container
docker compose exec postgres psql -U postgres -d mini_erp_crm
docker compose up --build api        # rebuild one service
docker compose down -v && docker compose up --build   # start completely fresh
```

Run the Postman collection against the containers:

```bash
npx newman run postman/Mini-ERP-CRM.postman_collection.json \
  -e postman/Mini-ERP-CRM.postman_environment.json
```

The collection's default `baseUrl` is already `http://localhost:4000/api`, which is where the `api`
container publishes.

---

## 6. Docker vs. running it directly

Both are supported; neither is the "real" one.

| | Docker | Local (`npm run dev`) |
| --- | --- | --- |
| Setup | One command, nothing installed | Node 20 + PostgreSQL required |
| Hot reload | No — rebuild to see changes | Yes, both apps |
| Best for | Reviewing it, or a clean environment | Actually developing |

The container images are production-shaped: no compiler, no test suite, no source, non-root, health
checks. `docker-compose.yml` sets `NODE_ENV=development` for the API so error responses carry a
stack trace and the seed runs without the production safety catch — a laptop stack should be
debuggable. Deployments use the production settings in `render.yaml`.

---

## 7. Troubleshooting

| Symptom | Cause |
| --- | --- |
| Nothing at `http://localhost`, or at `http://localhost:5173` | The app is on **`WEB_PORT`, default 8080**. Nothing is published on port 80, so the bare hostname serves nothing; and 5173 is the Vite dev server, which only runs under `npm run dev`. Check `docker compose ps` — if `web` is `Up (healthy)`, the containers are fine and it is the URL that is wrong |
| `port is already allocated` | Something already holds 8080, 4000 or 5433. Change it — see §4 — or stop the other process |
| App loads, every request fails with a CORS error | `CORS_ORIGINS` does not match the browser's origin. It must equal `http://localhost:<WEB_PORT>` exactly |
| App calls the wrong API URL | `VITE_API_BASE_URL` changed without a rebuild (§3) |
| `api` exits immediately | Read `docker compose logs api`. Usually a migration failure or an unreachable database — the API refuses to serve without one |
| `api` restarts in a loop on first run | PostgreSQL was still initialising. The health check gate normally prevents this; `docker compose down -v` and start again |
| Refreshing a deep link 404s | nginx is not using `frontend/nginx.conf`. Rebuild `web` |
| Data disappeared | `docker compose down -v` deletes the volume. Use `down` without `-v` to keep it |
| Changes to source do nothing | Expected — the images are built, not mounted. Use `npm run dev` for hot reload |
