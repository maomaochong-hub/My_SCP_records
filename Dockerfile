# 单容器镜像：零依赖，连 npm install 都不需要
FROM node:22-alpine

WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000 \
    SITE_TZ=Asia/Shanghai

# 只带运行必需的文件（server 无第三方依赖）
COPY package.json ./
COPY server ./server
COPY scripts ./scripts
COPY public ./public

# 数据目录：容器内可写，但**必须挂持久卷**，否则重启即丢
RUN mkdir -p /app/data
VOLUME ["/app/data"]

EXPOSE 3000
CMD ["node", "server/server.js"]
