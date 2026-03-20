# ===========================================
# neu-scholar-backend — Dockerfile (FIXED)
# ===========================================

FROM node:20-bookworm-slim AS base

WORKDIR /app

# Dependencies cho native modules
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ curl \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./

# ===========================================
# Stage: development
# ===========================================
FROM base AS development
RUN npm install
COPY . .
EXPOSE 8014
CMD ["npm", "run", "dev"]

# ===========================================
# Stage: production
# ===========================================
FROM base AS production

RUN NODE_OPTIONS="--max-old-space-size=2048" npm ci --omit=dev

COPY . .

EXPOSE 8014
ENV NODE_ENV=production

# 🔥 WAIT + SYNC SAFE + START
CMD ["sh", "-c", "\
echo '⏳ Waiting for services...'; \
sleep 5; \
echo '🚀 Start sync (safe mode)...'; \
node sync_qdrant.js || echo '⚠️ Sync failed, continue...'; \
echo '🚀 Starting server...'; \
node app.js \
"]