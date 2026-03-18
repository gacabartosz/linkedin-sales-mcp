FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

FROM node:22-alpine
RUN apk add --no-cache python3 make g++ && \
    mkdir -p /data/.linkedin-mcp
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && apk del python3 make g++
COPY --from=builder /app/dist ./dist
EXPOSE 3100
VOLUME /data
ENV DATA_DIR=/data/.linkedin-mcp
ENV NODE_ENV=production
CMD ["node", "dist/server.js"]
