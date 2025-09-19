FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json* pnpm-lock.yaml* ./
RUN npm i --production || true
COPY . .
ENV NODE_OPTIONS="--enable-source-maps"
CMD ["node","index.js"]
