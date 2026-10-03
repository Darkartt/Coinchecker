import { describe, it, expect, vi } from 'vitest';
import { Providers, num, flag } from '../apps/api/src/providers';
import { settings } from '../apps/api/src/config';
import { ScanService } from '../apps/api/src/scan-service';
import type { Database } from '../apps/api/src/database';
import { input, sources, POOL, TOKEN } from './fixtures';
const db = {
  redis: { set: async () => true },
  pool: { query: async () => ({ rows: [] }) },
} as unknown as Database;
function provider(values: unknown[], config = {}) {
  const fetcher = vi.fn(async () => {
    const value = values.shift();
    return value instanceof Response
      ? value
      : new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  return {
    p: new Providers(
      {
        ...settings,
        ETHERSCAN_API_KEY: '',
        COINGECKO_API_KEY: '',
        GOPLUS_ACCESS_TOKEN: '',
        HONEYPOT_API_KEY: '',
        ...config,
      },
      db,
      fetcher,
    ),
    fetcher,
  };
}
describe('provider boundaries', () => {
  it('does not reuse reports across changed provider coverage or production permission', () => {
    const key = (config = {}) => new ScanService(db, provider([], config).p).cacheKey(input);
    const development = key();
    expect(key()).toBe(development);
    expect(key({ NODE_ENV: 'production', HONEYPOT_PRODUCTION_PERMISSION: 'false' })).not.toBe(
      development,
    );
    expect(key({ ETHERSCAN_API_KEY: 'fixture-secret' })).not.toBe(development);
    const privateNode = key({ BASE_RPC_URL: 'https://node.example/fixture-secret' });
    expect(privateNode).not.toBe(development);
    expect(privateNode).not.toContain('fixture-secret');
  });
  it('preserves absent flags and rejects non-numeric fields', () => {
    expect(flag('')).toBeNull();
    expect(flag('yes')).toBeNull();
    expect(num(' ')).toBeNull();
    expect(num('NaN')).toBeNull();
    expect(num(false)).toBeNull();
  });
  it('matches GoPlus results by exact contract address', async () => {
    const { p } = provider([{ code: 1, result: { [POOL]: { is_honeypot: '0' } } }]);
    expect((await p.goplus(input)).status).toBe('unsupported');
  });
  it('rejects malformed JSON and masks credential-bearing exceptions', async () => {
    const { p } = provider([new Response('bad')]);
    expect((await p.goplus(input)).message).toContain('malformed JSON');
    const fail = new Providers({ ...settings }, db, async () => {
      throw new Error('secret-access-token');
    });
    const r = await fail.goplus(input);
    expect(JSON.stringify(r)).not.toContain('secret-access-token');
  });
  it('filters wrong-chain and unrelated market pools', async () => {
    const pairs = [
      ...(sources()[2]!.data as any[]),
      { chainId: 'ethereum', baseToken: { address: TOKEN } },
      { chainId: 'base', baseToken: { address: POOL } },
    ];
    const { p } = provider([pairs]);
    expect((await p.dex(input)).data).toHaveLength(1);
  });
  it('verifies simulation token, chain, pool, exchange type and router', async () => {
    const hp = sources()[1]!.data as any;
    const mismatch = provider([{ ...hp, pairAddress: TOKEN }]);
    expect((await mismatch.p.honeypot({ ...input, pairAddress: POOL })).status).toBe('unsupported');
    const wrongChain = provider([{ ...hp, chain: { id: '1' } }]);
    expect((await wrongChain.p.honeypot(input)).status).toBe('unsupported');
    const unsupported = provider([
      { ...hp, pair: { pair: { address: POOL, type: 'Aerodrome' } }, router: '' },
    ]);
    const r = await unsupported.p.honeypot(input);
    expect(r.status).toBe('unsupported');
    expect(r.data).not.toBeNull();
    const good = provider([hp]);
    expect((await good.p.honeypot({ ...input, pairAddress: POOL })).status).toBe('ok');
  });
  it('rejects internally inconsistent zero-gas successful simulations', async () => {
    const hp = sources()[1]!.data as any;
    const { p } = provider([{ ...hp, simulationResult: { buyGas: 0, sellGas: 0, sellTax: 100 } }]);
    expect((await p.honeypot(input)).status).toBe('unsupported');
  });
  it('reports missing keys without making requests', async () => {
    const { p, fetcher } = provider([]);
    expect((await p.etherscan(input)).status).toBe('not_configured');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('requires cleared Honeypot production permission before requests', async () => {
    const { p, fetcher } = provider([], {
      NODE_ENV: 'production',
      HONEYPOT_PRODUCTION_PERMISSION: 'false',
    });
    expect((await p.honeypot(input)).status).toBe('not_configured');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('runs authenticated Etherscan source/deployment/implementation contracts', async () => {
    const { p, fetcher } = provider(
      [
        { status: '1', result: [{ SourceCode: 'verified', Proxy: '1', Implementation: POOL }] },
        {
          status: '1',
          result: [
            {
              contractAddress: TOKEN,
              contractCreator: POOL,
              txHash: '0x' + 'a'.repeat(64),
              timestamp: '1700000000',
            },
          ],
        },
        { status: '1', result: [{ SourceCode: 'implementation' }] },
      ],
      { ETHERSCAN_API_KEY: 'fixture-key' },
    );
    const r = await p.etherscan(input);
    expect(r.status).toBe('ok');
    expect((r.data as any).implementationSource.SourceCode).toBe('implementation');
    expect((fetcher as any).mock.calls[0][0].searchParams.get('chainid')).toBe('8453');
    expect(JSON.stringify(r)).not.toContain('fixture-key');
  });
  it('keeps metadata with explicit partial coverage on a chart outage', async () => {
    const { p } = provider(
      [{ id: 'fixture', platforms: { base: TOKEN } }, new Response('{}', { status: 503 })],
      { COINGECKO_API_KEY: 'fixture-key' },
    );
    const r = await p.coingecko(input);
    expect(r.status).toBe('partial');
    expect((r.data as any).metadata.id).toBe('fixture');
  });
  it('rejects CoinGecko metadata for a different contract', async () => {
    const { p } = provider([{ id: 'fixture', platforms: { base: POOL } }]);
    expect((await p.coingecko(input)).status).toBe('unsupported');
  });
});
