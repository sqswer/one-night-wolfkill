# 一夜狼人杀在线版 · 部署镜像
# ⚠️ 必须用 glibc 基础镜像：sherpa-onnx 的 linux 二进制是 glibc 的，alpine(musl) 跑不起来。
FROM node:20-bookworm-slim
WORKDIR /app

# 系统依赖：tar 解压模型、ca-certificates 让 https 下载可用
RUN apt-get update \
 && apt-get install -y --no-install-recommends tar ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY package.json ./
RUN npm install --omit=dev

# 复制源码（.dockerignore 已排除 tts-bin/node_modules/.git 等本地大文件）
COPY . .

ENV PORT=3000
EXPOSE 3000

# 启动前由 ensure_tts.js 幂等确认 MeloTTS 就位（已装跳过、缺则联网装、失败不阻断），再起服务
CMD ["npm", "start"]
