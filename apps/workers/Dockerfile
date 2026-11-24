# Build from the repo root: docker build -f apps/workers/Dockerfile .
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY apps/workers/package.json apps/workers/
RUN pnpm install --frozen-lockfile --filter @agriprice/workers...
COPY apps/workers apps/workers
RUN pnpm --filter @agriprice/workers build && pnpm deploy --legacy --filter @agriprice/workers --prod /out

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /out/package.json ./
COPY --from=build /repo/apps/workers/dist ./dist
USER node
CMD ["node", "dist/main.js"]
