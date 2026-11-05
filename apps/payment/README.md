# @rusuh/payment-service

Payment service: Midtrans Snap wrapper, webhook + Get Status confirmation, attempts.

Part of the `rusuh-core` monorepo. Same boilerplate as `rusuh-mock`
(Express + CommonJS, Jest + Supertest, ESLint airbnb-base + Prettier).

## Run

```sh
npm ci
npm start          # PORT=8083 by default
npm run check      # format + lint + tests + coverage
```

## Design

- LLD: `rusuh-documentation/architecture/lld-0X-*.md`
- Contract: `rusuh-documentation/api/openapi.yaml`
