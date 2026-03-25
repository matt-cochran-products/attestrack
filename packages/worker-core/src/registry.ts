/**
 * Bundled strategy lists are built in `@attestrue/strategies` (`defaultCommunityStrategies`, etc.).
 * Per-request CDN / marketplace extensions come from {@link StrategyLoader} on the worker.
 * Before each request pipeline, `resolveStrategiesWithReplaces` (from `@attestrue/sdk`) merges
 * bundled + loaded strategies so `manifest.replaces` can swap community slots for premium ones.
 */
export const strategyRegistryVersion = 1
