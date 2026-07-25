# Contributing to Attestrack

Attestrack is the MIT-licensed analytics and server-side measurement stack in this repository. Thank you for helping improve it.

Please follow the [Code of Conduct](CODE_OF_CONDUCT.md). Security issues go through [SECURITY.md](SECURITY.md) (private advisories), never public issues.

## Prerequisites

- Node.js 20+
- pnpm 9 (`packageManager` is pinned in the root `package.json`)

## Setup

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm test
pnpm route-contract-check
pnpm build
pnpm boundary-check
```

## Linting

The repo uses **ESLint 9** with the flat config in [`eslint.config.mjs`](eslint.config.mjs): `@eslint/js`, `typescript-eslint` (recommended + `no-explicit-any`), **`eslint-plugin-react`** and **`eslint-plugin-react-hooks`** for `packages/portal-community`, Cloudflare **Workers** globals for `worker-core` / `strategies` / `host-cloudflare-worker`, and a soft **`no-console`** rule (warnings; disabled in tests, scripts, and deploy CLI output). Run `pnpm lint` from the root before pushing.

## Pull requests

- Keep changes focused and match existing style (TypeScript strict, no semicolons, single quotes, no `any`).
- Business logic belongs in hooks for `portal-community`; components stay presentational.
- **OSS scope and Worker contracts:** See [docs/OSS-SCOPE-MATRIX.md](docs/OSS-SCOPE-MATRIX.md), [docs/REPO-SPEC-OSS.md](docs/REPO-SPEC-OSS.md), and [docs/TEST-STRATEGY.md](docs/TEST-STRATEGY.md). If you change HTTP routes or portal JSON errors, update `docs/oss-http-contract.json` and run `pnpm route-contract-check`.
- Do not add `packages/merkle` or reference the licensed sibling product tree in docs or code (see ADR-009 — `pnpm boundary-check` enforces part of this).
- If an ADR changes the public or licensed boundary, update `.cursorrules` / workspace rules in the same change.

## Testing

- Use **Vitest** everywhere packages already define `pnpm test`.
- Prefer testing through **public APIs** (`Strategy.run`, `createAttestrackFetchHandler`, published types) rather than internal helpers. See [`packages/sdk/docs/TESTING.md`](packages/sdk/docs/TESTING.md) and [docs/TEST-STRATEGY.md](docs/TEST-STRATEGY.md).
- Worker HTTP behavior: add or extend `packages/worker-core/__tests__/contract/*.contract.test.ts`.

## Deploy and OSS pilot

For an end-to-end Cloudflare run (Worker + KV + optional Pages portal) from this repo, see [`docs/PILOT-OSS.md`](docs/PILOT-OSS.md).

## Strategy and adapter authors

See [`ADAPTER-DEVELOPMENT-GUIDE.md`](ADAPTER-DEVELOPMENT-GUIDE.md) and [`packages/sdk/docs/ADAPTER-GUIDE.md`](packages/sdk/docs/ADAPTER-GUIDE.md). Community strategy submissions (STR.5) use the dedicated PR template — open your PR with `?template=community_strategy.md` ([`.github/PULL_REQUEST_TEMPLATE/community_strategy.md`](.github/PULL_REQUEST_TEMPLATE/community_strategy.md)).

## License

By contributing, you agree your contributions are licensed under the same terms as the project ([MIT](LICENSE)).
