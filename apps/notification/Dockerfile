# syntax=docker/dockerfile:1.7
# Build context is the repository root (npm workspaces monorepo).
FROM node:24.22.3-bookworm-slim AS dependencies
WORKDIR /usr/src/app
COPY package.json package-lock.json ./
COPY packages/ ./packages/
COPY apps/auth/package.json ./apps/auth/package.json
COPY apps/core/package.json ./apps/core/package.json
COPY apps/payment/package.json ./apps/payment/package.json
COPY apps/notification/package.json ./apps/notification/package.json
COPY apps/officer/package.json ./apps/officer/package.json
COPY apps/admin/package.json ./apps/admin/package.json
RUN npm ci --omit=dev --ignore-scripts

FROM gcr.io/distroless/nodejs24-debian13:nonroot
WORKDIR /usr/src/app
ENV NODE_ENV=production
COPY --from=dependencies --chown=nonroot:nonroot /usr/src/app/node_modules ./node_modules
COPY --from=dependencies --chown=nonroot:nonroot /usr/src/app/packages ./packages
COPY --chown=nonroot:nonroot apps/notification/package.json ./package.json
COPY --chown=nonroot:nonroot apps/notification/src ./src
USER nonroot
EXPOSE 8084
CMD ["src/server.js"]
