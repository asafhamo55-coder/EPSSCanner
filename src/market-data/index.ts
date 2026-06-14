import type { DataProvider } from './provider'
import { FmpProvider } from './providers/fmp'
import { MockProvider } from './providers/mock'
import { YahooProvider } from './providers/yahoo'

export type {
  DataProvider,
  EpsRow,
  ValuationSnapshot,
  AnnualRow,
} from './provider'
export { ProviderError } from './provider'
export { FmpProvider } from './providers/fmp'
export { MockProvider } from './providers/mock'
export { YahooProvider } from './providers/yahoo'

/**
 * Resolve the active provider from MARKET_DATA_PROVIDER ('yahoo' | 'fmp' |
 * 'mock').
 *
 * Mock is opt-IN only — synthetic data ONLY when MARKET_DATA_PROVIDER==='mock'.
 * With no explicit choice we use live FMP when an API key is configured, else
 * keyless Yahoo. We NEVER silently fall back to mock: that would fabricate
 * "(mock)" numbers in production. The keyless Yahoo fallback also means a
 * dropped/empty FMP key degrades to real Yahoo data instead of breaking ingest.
 */
export function getProvider(): DataProvider {
  const choice = process.env.MARKET_DATA_PROVIDER?.toLowerCase()
  if (choice === 'mock') return new MockProvider()
  if (choice === 'yahoo') return new YahooProvider()
  if (choice === 'fmp') return new FmpProvider()
  return process.env.MARKET_DATA_FMP_API_KEY ? new FmpProvider() : new YahooProvider()
}
