# 记事簿 · 私有化部署镜像
FROM node:20-alpine

WORKDIR /app
COPY server.js ./server.js
COPY lib ./lib
COPY public ./public
COPY website ./website
COPY config.example.json ./config.example.json

# 数据目录挂载点（docker run -v /your/path:/app/data）
RUN mkdir -p /app/data
VOLUME /app/data

ENV PORT=5320 HOST=0.0.0.0 DATA_DIR=/app/data

EXPOSE 5320
CMD ["node", "server.js"]
