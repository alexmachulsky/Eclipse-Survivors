FROM node:22-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY index.html tsconfig*.json vite.config.ts ./
COPY public ./public
COPY server ./server
COPY src ./src
RUN npm run build

FROM nginxinc/nginx-unprivileged:1.29-alpine AS runtime

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/ >/dev/null || exit 1

FROM node:22-alpine AS server

WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist-server ./dist-server

USER node

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3001/health >/dev/null || exit 1

CMD ["node", "dist-server/index.js"]
