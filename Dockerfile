# ===========================================
# neu-scholar-backend — Dockerfile
# ===========================================

FROM node:20-bookworm-slim AS base

WORKDIR /app

# Dependencies cho native modules
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
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

# 🔥 CHẠY SYNC + START SERVER
CMD ["sh", "-c", "node sync_qdrant.js && node app.js"]