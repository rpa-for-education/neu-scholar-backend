# ===========================================
# neu-scholar-backend — Dockerfile
# ===========================================
# Multi-stage: production (slim) và development (full deps)
# Sử dụng MongoDB Atlas, không có MongoDB local trong Docker

FROM node:20-alpine AS base

WORKDIR /app

# Dependencies cho native modules (nếu có)
RUN apk add --no-cache python3 make g++

# Copy package files
COPY package.json package-lock.json* ./

# ===========================================
# Stage: development — npm install đầy đủ
# ===========================================
FROM base AS development
RUN npm install
COPY . .
EXPOSE 8014
CMD ["npm", "run", "dev"]

# ===========================================
# Stage: production — npm ci, chạy tối ưu
# ===========================================
FROM base AS production
RUN npm ci --omit=dev
COPY . .
EXPOSE 8014
ENV NODE_ENV=production
CMD ["npm", "start"]
