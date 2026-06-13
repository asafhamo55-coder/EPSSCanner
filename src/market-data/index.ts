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
 * 'mock'). 'yahoo' is keyless live data; 'fmp' needs a key. Defaults to 'fmp'
 * when a key is configured, else 'mock' so local dev and CI never hit the
 * network unintentionally.
 */
export function getProvider(): DataProvider {
  const choice = process.env.MARKET_DATA_PROVIDER?.toLowerCase()
  if (choice === 'mock') return new MockProvider()
  if (choice === 'yahoo') return new YahooProvider()
  if (choice === 'fmp') return new FmpProvider()
  return process.env.MARKET_DATA_FMP_API_KEY ? new FmpProvider() : new MockProvider()
}
