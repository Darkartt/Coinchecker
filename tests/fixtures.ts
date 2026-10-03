import { type ProviderResult, type SourceId, type Json, type ScanInput } from '@coinchecker/shared';
import { analyze } from '../apps/api/src/analyzer';
import { digest } from '../apps/api/src/providers';
export const TOKEN = '0x1111111111111111111111111111111111111111';
export const POOL = '0x2222222222222222222222222222222222222222';
export const input: ScanInput = { chainId: '8453', address: TOKEN };
export function source(
  source: SourceId,
  data: Json,
  status: ProviderResult['status'] = 'ok',
): ProviderResult {
  return {
    source,
    data,
    status,
    checkedAt: new Date().toISOString(),
    durationMs: 1,
    digest: digest(data),
  };
}
export function sources(overrides: Partial<Record<SourceId, Json>> = {}): ProviderResult[] {
  const data: Record<SourceId, Json> = {
    goplus: {
      token_name: 'Fixture',
      token_symbol: 'FIX',
      is_honeypot: '0',
      cannot_sell_all: '0',
      is_mintable: '0',
      is_blacklisted: '0',
      slippage_modifiable: '0',
      transfer_pausable: '0',
      is_open_source: '1',
      buy_tax: '0',
      sell_tax: '0',
      holders: [],
      dex: [{ pair: POOL }],
      lp_holders: [{ percent: '1', is_locked: '1' }],
    },
    honeypot: {
      summary: { risk: 'low' },
      simulationSuccess: true,
      simulationResult: { buyTax: 0, sellTax: 0, buyGas: '100000', sellGas: '110000' },
      honeypotResult: { isHoneypot: false },
      token: { address: TOKEN },
      chain: { id: '8453' },
      pair: { pair: { address: POOL, type: 'UniswapV2' } },
      pairAddress: POOL,
      router: '0x3333333333333333333333333333333333333333',
    },
    dexscreener: [
      {
        chainId: 'base',
        pairAddress: POOL,
        dexId: 'uniswap',
        baseToken: { address: TOKEN, symbol: 'FIX' },
        quoteToken: { address: '0x4444444444444444444444444444444444444444', symbol: 'WETH' },
        liquidity: { usd: 100000 },
        priceUsd: '1',
        volume: { h24: 1000 },
        labels: ['v2'],
        pairCreatedAt: Date.now() - 100000,
      },
    ],
    etherscan: {
      source: { SourceCode: 'contract Fixture {}' },
      creation: { timestamp: '1700000000' },
    },
    coingecko: {
      metadata: {
        id: 'fixture',
        platforms: { base: TOKEN },
        description: { en: 'Fixture data' },
        links: { homepage: [] },
      },
      chart: { prices: [] },
    },
    rpc: {
      isContract: true,
      name: 'Fixture',
      symbol: 'FIX',
      blockNumber: '123',
      events: [],
      implementation: null,
    },
  };
  return (Object.keys(data) as SourceId[]).map((id) => source(id, overrides[id] ?? data[id]));
}
export function report(overrides: Partial<Record<SourceId, Json>> = {}) {
  return analyze(input, sources(overrides));
}
