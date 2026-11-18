FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci --workspace @tracker/api --include-workspace-root
COPY apps/api apps/api
RUN npm run build -w @tracker/api

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/apps/api/dist ./dist
COPY --from=build --chown=node:node /app/apps/api/migrations ./migrations
COPY --from=build --chown=node:node /app/apps/api/package.json ./package.json
RUN mkdir -p /data/attachments && chown node:node /data/attachments
USER node
EXPOSE 3000
CMD ["node", "dist/index.js"]
