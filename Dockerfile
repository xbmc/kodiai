# Stage 1: Install production dependencies
ARG BUN_BASE_IMAGE=oven/bun:1.3.8-debian
FROM ${BUN_BASE_IMAGE} AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --production --frozen-lockfile --omit optional
COPY tsconfig.json ./
COPY src/ ./src/
RUN bun build src/index.ts --target=bun --packages=external --outfile=dist/index.js
RUN mkdir -p dist/migrations && cp src/db/migrations/*.sql dist/migrations/

# Stage 2: Production image
FROM ${BUN_BASE_IMAGE}

# git is required for workspace manager (git clone)
# clang-format provides git-clang-format for default explicit formatter suggestions
# python3 + kodi-addon-checker required for addon lint checks
RUN apt-get update && apt-get install -y --no-install-recommends git clang-format ca-certificates python3 python3-pip && pip3 install --no-cache-dir --break-system-packages kodi-addon-checker==0.0.36 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy production dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules

# Copy compiled application
COPY package.json bun.lock tsconfig.json ./
COPY --from=deps /app/dist ./dist

# DATABASE_URL is provided via Azure Container Apps secrets at runtime
ENV DATABASE_URL=""

# Run as non-root user (oven/bun images include 'bun' user)
USER bun

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 CMD bun -e "const port = process.env.PORT || '3000'; const res = await fetch('http://127.0.0.1:' + port + '/healthz'); if (!res.ok) process.exit(1); const body = await res.json().catch(() => undefined); if (body?.status !== 'ok') process.exit(1);"

CMD ["bun", "run", "dist/index.js"]
