FROM node:24-alpine AS base
WORKDIR /app

# 纯 Node 内置模块，无 npm 依赖，不需要 install 步骤
COPY package.json ./
COPY server.js ./
COPY src ./src
COPY config ./config
COPY public ./public

RUN mkdir -p /app/data
ENV NODE_ENV=production \
    PORT=8052 \
    HOST=0.0.0.0 \
    DB_FILE=/app/data/cardweb.db \
    POLL_MINUTES=0

EXPOSE 8052
VOLUME ["/app/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8052/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
