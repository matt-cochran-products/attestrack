/**
 * Bundled strategy lists are built in `@attestrack/strategies` (`defaultCommunityStrategies`, etc.).
 * Per-request CDN / marketplace extensions come from {@link StrategyLoader} on the worker.
 * Before each request pipeline, `resolveStrategiesWithReplaces` (from `@attestrack/sdk`) merges
 * bundled + loaded strategies so `manifest.replaces` can swap community slots for premium ones.
 */
export const strategyRegistryVersion = 1
