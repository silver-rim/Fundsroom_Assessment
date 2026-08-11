# syntax=docker/dockerfile:1

# =============================================================================
# Mini ERP + CRM — web image
#
# Builds the SPA, then serves the static output with nginx. The runtime stage
# contains no Node.js at all: after `vite build` this app is HTML, CSS and JS.
# =============================================================================

# ---- Stage 1: build ---------------------------------------------------------
FROM node:20-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

# IMPORTANT: Vite inlines VITE_* variables into the bundle at BUILD time, so
# this is a build argument, not a runtime environment variable. Changing the
# API URL means rebuilding the image — restarting the container does nothing.
#
# The default is the host-mapped API port, because the value is resolved by the
# BROWSER, which is outside the Docker network. `http://api:4000` would work
# between containers and fail in the browser every time.
ARG VITE_API_BASE_URL=http://localhost:4000/api
ARG VITE_APP_NAME="Mini ERP + CRM"
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
ENV VITE_APP_NAME=$VITE_APP_NAME

COPY tsconfig.json tsconfig.test.json vite.config.ts index.html ./
COPY src ./src

# `npm run build` type-checks first, so a type error fails the image build
# rather than shipping.
RUN npm run build


# ---- Stage 2: runtime -------------------------------------------------------
FROM nginx:1.27-alpine AS runtime

# Replaces the default site with one that knows this is a single-page app.
COPY nginx.conf /etc/nginx/conf.d/default.conf

COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=15s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -q --spider http://127.0.0.1/ || exit 1
