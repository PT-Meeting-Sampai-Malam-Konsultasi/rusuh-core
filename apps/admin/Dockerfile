# syntax=docker/dockerfile:1.7
FROM node:20.16.0-bookworm-slim AS dependencies
WORKDIR /usr/src/app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

FROM gcr.io/distroless/nodejs20-debian12:nonroot
WORKDIR /usr/src/app
ENV NODE_ENV=production
COPY --from=dependencies --chown=nonroot:nonroot /usr/src/app/node_modules ./node_modules
COPY --chown=nonroot:nonroot package.json ./package.json
COPY --chown=nonroot:nonroot src ./src
USER nonroot
EXPOSE 8086
CMD ["src/server.js"]
