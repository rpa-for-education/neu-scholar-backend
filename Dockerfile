# ===========================================
# neu-scholar-backend — Dockerfile (FINAL)
# ===========================================

FROM node:20-bookworm-slim AS base

WORKDIR /app

# Native deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ curl \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./

# ===========================================
# DEV
# ===========================================
FROM base AS development
RUN npm install
COPY . .
EXPOSE 8014
CMD ["npm", "run", "dev"]

# ===========================================
# PROD
# ===========================================
FROM base AS production

# 🔥 FIX QUAN TRỌNG: đảm bảo install đủ deps (có p-queue)
RUN npm ci --omit=dev || npm install --omit=dev

# ===========================================
# 🔥 FIX PLAYWRIGHT (CHỈ THÊM ĐOẠN NÀY)
# ===========================================
RUN npx playwright install --with-deps chromium

# ===========================================

COPY . .

EXPOSE 8014
ENV NODE_ENV=production

CMD ["sh", "-c", "\
echo '⏳ Waiting for services...'; \
sleep 5; \
echo '🚀 Sync FUND...'; \
node scripts/sync_fund_qdrant.js || echo '⚠️ FUND failed'; \
echo '🚀 Sync SCHOLAR...'; \
node scripts/sync_scholar_qdrant.js || echo '⚠️ SCHOLAR failed'; \
echo '🚀 Starting server...'; \
node app.js \
"]