FROM node:20-alpine

WORKDIR /app

# 🔥 install curl để wait Qdrant
RUN apk add --no-cache curl

# install deps
COPY package*.json ./
RUN npm install

# copy source
COPY . .

# run sync
CMD ["node", "src/jobs/syncAllQdrant.js"]