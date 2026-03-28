# ===========================================
# 🧱 BASE IMAGE
# ===========================================
FROM node:20-bookworm-slim

WORKDIR /app

# ===========================================
# 🔥 INSTALL SYSTEM LIBS (PLAYWRIGHT)
# ===========================================
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

# ===========================================
# 📦 INSTALL DEPENDENCIES
# ===========================================
COPY package*.json ./
RUN npm install

# ===========================================
# 📁 COPY SOURCE
# ===========================================
COPY . .

# ===========================================
# 🔥 INSTALL PLAYWRIGHT BROWSER
# ===========================================
RUN npx playwright install chromium

# ===========================================
# 🚀 START (CRAWL + ENRICH LOOP)
# ===========================================
CMD ["sh", "-c", "\
echo '🚀 Crawler started...'; \
while true; do \
  echo '🌐 Crawl EasyChair...'; \
  node src/jobs/crawl_easychair.js || echo '⚠️ Crawl fail'; \
  \
  echo '🤖 Enrich incremental...'; \
  node src/jobs/enrich_easychair.js || echo '⚠️ Enrich fail'; \
  \
  echo '😴 Sleep 6 hours...'; \
  sleep 21600; \
done \
"]