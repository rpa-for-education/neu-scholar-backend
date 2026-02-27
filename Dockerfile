# ===========================================
# neu-scholar-backend — Dockerfile
# ===========================================
# Multi-stage: production (slim) và development (full deps)
# Sử dụng MongoDB Atlas, không có MongoDB local trong Docker
#
# Lưu ý: Dùng Debian (không dùng Alpine) vì onnxruntime-node cần glibc,
# Alpine dùng musl → lỗi ld-linux-aarch64.so.1

FROM node:20-bookworm-slim AS base

WORKDIR /app

# Dependencies cho native modules (onnxruntime-node, pdf-parse, etc.)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

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
# Tăng memory cho npm (tránh OOM trên máy chủ Portainer)
ENV NODE_OPTIONS="--max-old-space-size=2048"
RUN npm ci --omit=dev
COPY . .
EXPOSE 8014
ENV NODE_ENV=production
CMD ["npm", "start"]
