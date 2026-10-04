# Contributing

Thanks for taking the time.

## Before you open a PR

**Some files in this repo are generated** and a PR against them will be
overwritten on the next sync. They carry a banner saying so at the top. In this
repo that is everything except `README.md`.

If one of those is wrong, that is a real bug worth reporting — open an issue
saying which file and what is wrong with it, and it gets fixed at the source.

## What is most useful

- **A wrong or misleading spec.** `openapi.json` is the contract. If an
  endpoint behaves differently from how it is documented, we would rather know.
- **A broken example.** Every example should run as written.
- **Ergonomics.** If something took you three tries to get right, say so — that
  is a design problem, not a you problem.

## Reporting a bug

Open an issue with a **minimal reproduction**: the smallest request that shows
the problem, what you got, and what you expected. Include the `X-Request-Id`
from the response — it is the only handle that ties what you saw to what we
logged.

Do not include API keys, customer data, or full response bodies from a real
account.

## Security

Do not open an issue. See [SECURITY.md](./SECURITY.md).
