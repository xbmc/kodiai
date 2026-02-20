# Stage 1: Install production dependencies
FROM oven/bun:1-debian AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --production --frozen-lockfile

# Stage 2: Production image
FROM oven/bun:1-debian

# git is required for workspace manager (git clone)
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy production dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules

# Copy application source
COPY package.json bun.lock tsconfig.json ./
COPY src/ ./src/

# Create data directory for telemetry SQLite database
RUN mkdir -p /app/data && chown bun:bun /app/data

# Run as non-root user (oven/bun images include 'bun' user)
USER bun

EXPOSE 3000

CMD ["bun", "run", "src/index.ts"]
