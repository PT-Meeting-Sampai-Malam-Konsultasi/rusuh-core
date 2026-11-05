# @rusuh/officer-service

Officer service: gate operations (ticket lookup, NIK display after scan, mark used).

Part of the `rusuh-core` monorepo. Same boilerplate as `rusuh-mock`
(Express + CommonJS, Jest + Supertest, ESLint airbnb-base + Prettier).

## Run

```sh
npm ci
npm start          # PORT=8085 by default
npm run check      # format + lint + tests + coverage
```

## Design

- LLD: `rusuh-documentation/architecture/lld-0X-*.md`
- Contract: `rusuh-documentation/api/openapi.yaml`
