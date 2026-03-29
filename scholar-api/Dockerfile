FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

# 🔥 expose đúng port mới
EXPOSE 8029

# 🔥 chạy server
CMD ["node", "server.js"]