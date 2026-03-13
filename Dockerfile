# 1. 使用 Node.js 鏡像來編譯 (相容性最強)
FROM node:20-slim AS builder
WORKDIR /app

# 安裝 bun (如果一定要用 bun install)
RUN npm install -g bun

COPY package.json bun.lockb* ./
# 這裡改用 --ignore-scripts 避開 prepare
RUN bun install --ignore-scripts

COPY . .
# 手動執行 build
RUN bun run build

FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/.output ./.output

EXPOSE 3000
CMD ["node", "./.output/server/index.mjs"]