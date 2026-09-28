FROM node:20-bookworm-slim

WORKDIR /app

# Thư viện hệ thống cho Playwright
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    fonts-liberation \
    libasound2 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxrandr2 \
    libxkbcommon0 \
    libxshmfence1 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm install

COPY . .

RUN npx playwright install chromium

CMD ["sh", "-c", "\
set -e; \
echo 'JOURNAL'; \
node src/jobs/import_journal_full.js; \
echo 'GSNN'; \
node src/jobs/import_journal_gsnn_full.js; \
echo 'FUND'; \
node src/jobs/import_fund_full.js; \
echo 'OTHER FUND'; \
node src/jobs/import_fund_other_full.js; \
echo 'NEU CONFERENCES'; \
node src/jobs/import_conference_neu.js; \
echo '🚀 Crawler started...'; \
while true; do \
  echo '🌐 Crawl EasyChair...'; \
  node src/jobs/crawl_easychair.js || echo '⚠️ Crawl fail'; \
  echo '🤖 Enrich incremental...'; \
  node src/jobs/enrich_easychair.js || echo '⚠️ Enrich fail'; \
  echo '😴 Sleep 6 hours...'; \
  sleep 21600; \
done \
"]