FROM node:18-slim
RUN mkdir -p /data/.linkedin-mcp
WORKDIR /app
COPY package.json ./
COPY dist/ ./dist/
COPY node_modules/ ./node_modules/
EXPOSE 3100
VOLUME /data
ENV DATA_DIR=/data/.linkedin-mcp
ENV NODE_ENV=production
CMD ["node", "dist/server.js"]
