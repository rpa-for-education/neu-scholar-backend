# ===========================================
# neu-scholar-backend — Dockerfile (FINAL)
# ===========================================

FROM node:20-bookworm-slim AS base

WORKDIR /app

# ===========================================
# 🔥 FIX QUAN TRỌNG: thêm full libs cho Playwright
# ===========================================
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ curl \
    libglib2.0-0 \
    libnss3 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    libpangocairo-1.0-0 \
    libgtk-3-0 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxtst6 \
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

# 🔥 đảm bảo đủ deps
RUN npm ci --omit=dev || npm install --omit=dev

# ===========================================
# 🔥 INSTALL PLAYWRIGHT (CHỈ BROWSER)
# ===========================================
RUN npx playwright install chromium

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