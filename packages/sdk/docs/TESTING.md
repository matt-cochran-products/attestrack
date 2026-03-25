# Testing

- Use **Vitest** and `createMockHostRuntime` from `@attestrue/sdk` to supply `HostRuntime` in unit tests.
- For consent tokens, test `createPrivacyConsentToken` / `verifyPrivacyConsentToken` round-trips (`packages/sdk/__tests__/consent-token.test.ts`).
- For worker HTTP behavior, test `createAttestrackFetchHandler` from `@attestrue/worker-core` with `Request` / `Response` globals (see `packages/worker-core/__tests__`).
