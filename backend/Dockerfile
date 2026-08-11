# syntax=docker/dockerfile:1

# =============================================================================
# Mini ERP + CRM — API image
#
# Two stages. The build stage needs TypeScript and the rest of the devDeps; the
# runtime stage gets only the compiled output and production dependencies, so
# the shipped image contains no compiler, no test suite and no source.
# =============================================================================

# ---- Stage 1: build ---------------------------------------------------------
FROM node:20-alpine AS build

WORKDIR /app

# Copied before the source so the dependency layer is cached and only
# reinstalls when the lockfile actually changes.
COPY package.json package-lock.json ./
RUN npm ci

# tsconfig.build.json extends tsconfig.json, so both are required.
COPY tsconfig.json tsconfig.build.json ./
COPY scripts ./scripts
COPY src ./src

# tsc -p tsconfig.build.json (excludes src/tests) + copies the .sql migrations
# into dist/db/migrations, which the migration runner reads at runtime.
RUN npm run build


# ---- Stage 2: runtime -------------------------------------------------------
FROM node:20-alpine AS runtime

WORKDIR /app

# The image is a production artifact. docker-compose.yml overrides this for the
# local demo stack, where readable errors matter more than terse ones.
ENV NODE_ENV=production

# --omit=dev drops typescript, tsx and @types/* — none of which run.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist

# The node:20 images ship an unprivileged `node` user. Nothing here needs root,
# and a container that cannot write to its own filesystem is one less thing to
# worry about.
USER node

EXPOSE 4000

# Uses the API's own health endpoint, which reports the DATABASE too — so an
# instance that cannot reach PostgreSQL is reported unhealthy rather than
# "running". Node 20 has global fetch, so this needs no curl in the image.
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Migrations are NOT run here: the image should do one thing. The compose file
# (and Render's start command) run them before starting the server.
CMD ["node", "dist/server.js"]
