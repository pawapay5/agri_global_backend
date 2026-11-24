# Build from the repo root: docker build -f apps/api/Dockerfile .
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/contracts/package.json packages/contracts/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter @agriprice/api...
COPY packages/contracts packages/contracts
COPY openapi openapi
COPY apps/api apps/api
COPY country-packs country-packs
RUN pnpm --filter @agriprice/contracts build && pnpm --filter @agriprice/api build \
 && pnpm deploy --filter @agriprice/api --prod /out

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /out/package.json ./
COPY --from=build /repo/apps/api/dist ./dist
COPY --from=build /repo/apps/api/migrations ./migrations
COPY --from=build /repo/apps/api/scripts ./scripts
COPY --from=build /repo/openapi /openapi
COPY --from=build /repo/country-packs /country-packs
USER node
EXPOSE 3001
HEALTHCHECK --interval=15s --timeout=3s CMD wget -qO- http://127.0.0.1:3001/healthz || exit 1
CMD ["node", "dist/main.js"]
