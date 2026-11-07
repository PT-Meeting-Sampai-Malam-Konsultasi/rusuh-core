# @rusuh/core-service

Transaction service: events, booking, hold (Valkey Lua), payment entry, tickets, sweeper.

Part of the `rusuh-core` monorepo. Same boilerplate as `rusuh-mock`
(Express + CommonJS, Jest + Supertest, ESLint airbnb-base + Prettier).

## Run

```sh
npm ci
npm start          # PORT=8082 by default
npm run check      # format + lint + tests + coverage
```

## Design

- LLD: `rusuh-documentation/architecture/lld-0X-*.md`
- Contract: `rusuh-documentation/api/openapi.yaml`

## Structure (Onion / Clean Architecture)

Dependencies point inward only; the rule is enforced by
`npm run check:boundaries` (scripts/check-boundaries.js), which runs as
part of `npm run check`.

```text
src/
  domain/          # center: pure business logic (fees, ids, nik, presenters,
                   #   problem, validation-token) + ports/ (adapter contracts
                   #   as JSDoc typedefs). No npm packages, no other layer.
  application/     # use cases (one folder per feature, <f>.use-case.js).
                   # Depends on domain/ + @rusuh/contracts only; adapters
                   # are injected, never required.
  infrastructure/  # adapters: config/, persistence/ (Postgres store),
                   #   cache/ (Valkey stock), messaging/ (SQS event bus),
                   #   external/ (Dukcapil, payment clients), sweeper.js.
  presentation/    # HTTP: http/{controllers,routes,middleware,validation}.
                   # May use application/ + domain/, never infrastructure/.
  platform/        # cross-cutting logger shim. Only the composition root
                   # (src/*.js) may import it; middleware receives it
                   # injected via app.js.
  container.js     # composition root: wires use cases + adapters + auth.
  app.js           # createApp (Express wiring). server.js = entry point.
```
