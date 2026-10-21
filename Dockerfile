FROM node:24-alpine AS base
WORKDIR /app

# curl 是备用抓取通道：目标站 WAF 按 TLS 指纹拦截 Node 的 OpenSSL 连接时，
# 换到 curl 的 TLS 栈就能继续抓（详见 src/fetcher.js 顶部注释）
RUN apk add --no-cache curl

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
