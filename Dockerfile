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

# Dependencies cho native modules (onnxruntime-node, sharp, pdf-parse, etc.)
# libvips: sharp dùng system libvips thay vì prebuild → tránh lỗi sharp-linux-arm64v8.node
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ libvips-dev \
    && rm -rf /var/lib/apt/lists/*

# Copy package files
COPY package.json package-lock.json* ./

# ===========================================
# Stage: development — npm install đầy đủ
# ===========================================
FROM base AS development
RUN npm install \
    && npm rebuild sharp --build-from-source
COPY . .
EXPOSE 8014
CMD ["npm", "run", "dev"]

# ===========================================
# Stage: production — npm ci, chạy tối ưu
# ===========================================
FROM base AS production
RUN npm ci --omit=dev \
    && npm rebuild sharp --build-from-source
COPY . .
EXPOSE 8014
ENV NODE_ENV=production
CMD ["npm", "start"]
