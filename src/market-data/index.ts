import type { DataProvider } from './provider'
import { FmpProvider } from './providers/fmp'
import { MockProvider } from './providers/mock'

export type {
  DataProvider,
  EpsRow,
  ValuationSnapshot,
  AnnualRow,
} from './provider'
export { ProviderError } from './provider'
export { FmpProvider } from './providers/fmp'
export { MockProvider } from './providers/mock'

/**
 * Resolve the active provider from MARKET_DATA_PROVIDER ('fmp' | 'mock').
 *
 * Mock is opt-IN only: you get synthetic data ONLY when MARKET_DATA_PROVIDER is
 * explicitly 'mock'. Every other value (including unset/empty) resolves to live
 * FMP. This is deliberate — a missing/empty API key must fail loudly inside the
 * FMP adapter rather than silently fabricating "(mock)" numbers in production.
 */
export function getProvider(): DataProvider {
  const choice = process.env.MARKET_DATA_PROVIDER?.toLowerCase()
  if (choice === 'mock') return new MockProvider()
  return new FmpProvider()
}
