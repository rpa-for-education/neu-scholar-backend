FROM node:20-bookworm-slim

# ⬇️ CÀI DEPENDENCY CHO SHARP
RUN apt-get update && apt-get install -y \
    libvips-dev \
    build-essential \
    python3 \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

EXPOSE 4000
CMD ["node", "server.js"]