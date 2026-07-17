# --- Deps stage (shared by the web build and the cast-server)
FROM node:23-alpine AS deps
WORKDIR /app

# Copy package.json first to cache node_modules
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .

# Match packageManager in package.json (pnpm is not bundled in the Node image)
RUN corepack enable && corepack prepare pnpm@11.5.2 --activate

RUN pnpm install

# Copy code and build with cached modules
COPY . .

# --- Builder stage
FROM deps AS builder
RUN pnpm run build:web

# --- Cast server stage
# Standalone WebSocket bridge so the web/PWA build can cast to Chromecast
# devices from any browser (not just Chrome, which is the only browser with a
# native Cast sender). Needs to reach the same LAN as the Chromecast devices —
# run with `--network host` on Linux. Docker Desktop on Mac/Windows does not
# expose real host networking, so device discovery there is limited to
# whatever Docker's NAT can reach.
#
# Installs from its own minimal package.json (src/cast-server/package.json)
# instead of the shared `deps` stage — this bridge only needs ws/castv2-client/
# bonjour-service/tsx, not the full monorepo's dependencies (Electron, mpv,
# etc.), which are unnecessary weight here and slow/unreliable to install
# under QEMU cross-platform emulation in CI.
FROM node:23-alpine AS cast-server-deps
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.5.2 --activate
COPY src/cast-server/package.json ./package.json
COPY pnpm-workspace.yaml .
RUN pnpm install

FROM cast-server-deps AS cast-server
COPY . .
ENV CAST_SERVER_PORT=9181
EXPOSE 9181
CMD ["node_modules/.bin/tsx", "--tsconfig", "src/cast-server/tsconfig.json", "src/cast-server/index.ts"]

# --- Production stage
FROM nginxinc/nginx-unprivileged:alpine-slim

COPY --chown=nginx:nginx --from=builder /app/out/web /usr/share/nginx/html
COPY --chown=nginx:nginx ./settings.js.template /etc/nginx/templates/settings.js.template
COPY --chown=nginx:nginx ng.conf.template /etc/nginx/templates/default.conf.template

ENV SERVER_LOCK=false SERVER_NAME="" SERVER_TYPE="" SERVER_URL="" REMOTE_URL=""
ENV LEGACY_AUTHENTICATION="" ANALYTICS_DISABLED="" PUBLIC_PATH="/" CAST_SERVER_URL=""

EXPOSE 9180
CMD ["nginx", "-g", "daemon off;"]
