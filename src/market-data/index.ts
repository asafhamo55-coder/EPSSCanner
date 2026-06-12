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
 * Defaults to 'fmp' in production; falls back to 'mock' when no FMP key is
 * configured so local dev and CI never hit the network.
 */
export function getProvider(): DataProvider {
  const choice = process.env.MARKET_DATA_PROVIDER?.toLowerCase()
  if (choice === 'mock') return new MockProvider()
  if (choice === 'fmp') return new FmpProvider()
  return process.env.MARKET_DATA_FMP_API_KEY ? new FmpProvider() : new MockProvider()
}
