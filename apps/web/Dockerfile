# AgriPrice web (Next.js standalone). Build from the repo root:
#   docker build -f apps/web/Dockerfile --build-arg NEXT_PUBLIC_SITE_URL=https://agriprice.example .
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter @agriprice/web...
COPY openapi openapi
COPY country-packs country-packs
COPY apps/web apps/web

# NEXT_PUBLIC_* values are inlined into the client bundle and the prerendered pages at build time.
ARG NEXT_PUBLIC_SITE_URL=http://localhost:3000
ARG NEXT_PUBLIC_GOOGLE_CLIENT_ID=
ARG NEXT_PUBLIC_APPLE_SERVICE_ID=
ARG NEXT_PUBLIC_FACEBOOK_APP_ID=
# Public support channels shown on /contact (optional).
ARG NEXT_PUBLIC_SUPPORT_EMAIL=
ARG NEXT_PUBLIC_SUPPORT_WHATSAPP=
# The API's public address, shown to developers on /app/developers (keys are sent there directly).
ARG NEXT_PUBLIC_API_PUBLIC_URL=
# Payment providers offered at checkout, comma-separated (paystack, flutterwave, stripe); must match what the API has keys for.
ARG NEXT_PUBLIC_BILLING_PROVIDERS=paystack
# Public host serving uploaded images (MinIO/S3), allowed in next/image.
ARG IMAGES_HOST=
ENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL \
    NEXT_PUBLIC_GOOGLE_CLIENT_ID=$NEXT_PUBLIC_GOOGLE_CLIENT_ID \
    NEXT_PUBLIC_APPLE_SERVICE_ID=$NEXT_PUBLIC_APPLE_SERVICE_ID \
    NEXT_PUBLIC_FACEBOOK_APP_ID=$NEXT_PUBLIC_FACEBOOK_APP_ID \
    NEXT_TELEMETRY_DISABLED=1
# Live data isn't needed at build: pages prerender from the country packs and fill prices at request time.
RUN pnpm --filter @agriprice/web build

FROM node:22-alpine
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /repo/apps/web/public ./apps/web/public
# Read at runtime (apps/web/src/lib/countries.ts resolves ../../country-packs from the app dir).
COPY --from=build --chown=node:node /repo/country-packs ./country-packs
USER node
WORKDIR /app/apps/web
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "server.js"]
