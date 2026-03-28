# ===========================================
# 🧠 scholar-backend — CLEAN PRODUCTION
# ===========================================

FROM node:20-bookworm-slim AS base

WORKDIR /app

# ===========================================
# 📦 INSTALL DEPENDENCIES
# ===========================================
COPY package.json package-lock.json* ./

# ===========================================
# DEV STAGE
# ===========================================
FROM base AS development
RUN npm install
COPY . .
EXPOSE 8014
CMD ["npm", "run", "dev"]

# ===========================================
# PROD STAGE
# ===========================================
FROM base AS production

# install only production deps
RUN npm ci --omit=dev || npm install --omit=dev

# copy source code
COPY . .

# ===========================================
# ENV + PORT
# ===========================================
ENV NODE_ENV=production
EXPOSE 8014

# ===========================================
# 🚀 START BACKEND (NO SYNC ANYMORE)
# ===========================================
CMD ["sh", "-c", "\
echo '🚀 Starting scholar-backend...'; \
node app.js \
"]