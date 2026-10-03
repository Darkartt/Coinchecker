import { createHash } from 'node:crypto';
import { createPublicClient, http, parseAbi, parseAbiItem, zeroAddress, getAddress } from 'viem';
import {
  NETWORKS,
  safeUrl,
  type Json,
  type ProviderResult,
  type ScanInput,
  type SourceId,
} from '@coinchecker/shared';
import type { Configuration } from './config.js';
import type { Database } from './database.js';

export function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
export function arr(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
export function str(value: unknown, max = 200): string | null {
  return typeof value === 'string' && value.trim() ? value.slice(0, max) : null;
}
export function num(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !value.trim()) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
export function flag(value: unknown): boolean | null {
  return value === '1' || value === 1 || value === true
    ? true
    : value === '0' || value === 0 || value === false
      ? false
      : null;
}
export function json(value: unknown): Json {
  return JSON.parse(JSON.stringify(value, (_, v) => (typeof v === 'bigint' ? v.toString() : v)));
}
export const digest = (value: Json) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');

class ProviderError extends Error {
  constructor(
    message: string,
    readonly status: ProviderResult['status'] = 'unavailable',
  ) {
    super(message);
  }
}
export class Providers {
  constructor(
    readonly config: Configuration,
    readonly db: Database,
    readonly fetcher: typeof fetch = fetch,
  ) {}
  private async request(url: URL, source: SourceId, headers: Record<string, string> = {}) {
    // Shared pacing across API replicas. Provider keys never enter logs or recorded evidence.
    const spacing =
      source === 'coingecko'
        ? 2200
        : source === 'goplus'
          ? 550
          : source === 'etherscan'
            ? 400
            : 150;
    for (let attempts = 0; attempts < 30; attempts++) {
      if (await this.db.redis.set(`provider-slot:${source}`, '1', { NX: true, PX: spacing })) break;
      if (attempts === 29)
        throw new ProviderError('Provider request queue is busy; try again shortly.');
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await this.fetcher(url, {
        headers,
        signal: AbortSignal.timeout(this.config.PROVIDER_TIMEOUT_MS),
        redirect: 'error',
      });
      if (response.status === 429 && attempt === 0) {
        await new Promise((r) => setTimeout(r, 1000));
        continue;
      }
      if (!response.ok)
        throw new ProviderError(
          response.status === 429
            ? 'Provider rate limit reached.'
            : `Provider returned HTTP ${response.status}.`,
        );
      const reader = response.body?.getReader();
      if (!reader) throw new ProviderError('Provider response was empty.');
      const chunks: Uint8Array[] = [];
      let length = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.length;
        if (length > 2_000_000) {
          await reader.cancel();
          throw new ProviderError('Provider response exceeded the supported size.');
        }
        chunks.push(value);
      }
      try {
        return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
      } catch {
        throw new ProviderError('Provider returned malformed JSON.');
      }
    }
    throw new ProviderError('Provider request could not be completed.');
  }
  private async run(
    source: SourceId,
    call: () => Promise<{ data: unknown; status?: ProviderResult['status']; message?: string }>,
  ): Promise<ProviderResult> {
    const start = Date.now(),
      checkedAt = new Date(start).toISOString();
    try {
      const result = await call();
      const data = json(result.data);
      return {
        source,
        status: result.status || 'ok',
        checkedAt,
        durationMs: Date.now() - start,
        data,
        digest: digest(data),
        message: result.message,
      };
    } catch (e) {
      const message =
        e instanceof ProviderError
          ? e.message
          : e instanceof Error && /timeout|abort/i.test(e.name + ' ' + e.message)
            ? 'Provider timed out.'
            : 'Provider connection failed.';
      return {
        source,
        status: e instanceof ProviderError ? e.status : 'unavailable',
        checkedAt,
        durationMs: Date.now() - start,
        message,
        data: null,
        digest: digest(null),
      };
    }
  }
  goplus(input: ScanInput) {
    return this.run('goplus', async () => {
      const url = new URL(`https://api.gopluslabs.io/api/v1/token_security/${input.chainId}`);
      url.searchParams.set('contract_addresses', input.address);
      const envelope = obj(
        await this.request(
          url,
          'goplus',
          this.config.GOPLUS_ACCESS_TOKEN
            ? { Authorization: `Bearer ${this.config.GOPLUS_ACCESS_TOKEN}` }
            : {},
        ),
      );
      if (num(envelope.code) !== 1)
        throw new ProviderError('GoPlus could not complete this token check.');
      const results = obj(envelope.result);
      const key = Object.keys(results).find((k) => k.toLowerCase() === input.address.toLowerCase());
      const data = obj(key ? results[key] : null);
      if (!Object.keys(data).length)
        throw new ProviderError('GoPlus has no security record for this token.', 'unsupported');
      return { data, status: Object.keys(data).length < 5 ? 'partial' : 'ok' };
    });
  }
  honeypot(input: ScanInput) {
    return this.run('honeypot', async () => {
      if (
        this.config.NODE_ENV === 'production' &&
        this.config.HONEYPOT_PRODUCTION_PERMISSION !== 'true'
      )
        throw new ProviderError(
          'Honeypot.is production integration is disabled until the operator has cleared provider permission for this product.',
          'not_configured',
        );
      const url = new URL('https://api.honeypot.is/v2/IsHoneypot');
      url.searchParams.set('address', input.address);
      url.searchParams.set('chainID', input.chainId);
      if (input.pairAddress) url.searchParams.set('pair', input.pairAddress);
      const data = obj(
        await this.request(
          url,
          'honeypot',
          this.config.HONEYPOT_API_KEY ? { 'X-API-KEY': this.config.HONEYPOT_API_KEY } : {},
        ),
      );
      if (!Object.keys(obj(data.summary)).length)
        throw new ProviderError('Honeypot.is returned no assessment.', 'unsupported');
      const tokenAddress = str(obj(data.token).address),
        chain = String(obj(data.chain).id ?? obj(data.pair).chainId ?? '');
      if (
        !tokenAddress ||
        tokenAddress.toLowerCase() !== input.address.toLowerCase() ||
        chain !== input.chainId
      )
        throw new ProviderError(
          'Simulation token or network did not match this scan.',
          'unsupported',
        );
      const actualPair = str(data.pairAddress) || str(obj(obj(data.pair).pair).address);
      if (input.pairAddress && actualPair?.toLowerCase() !== input.pairAddress.toLowerCase())
        throw new ProviderError('The provider did not simulate the selected pool.', 'unsupported');
      const route = obj(obj(data.pair).pair),
        router = str(data.router) || str(obj(data.pair).router);
      if (
        !['UniswapV2', 'UniswapV3'].includes(str(route.type) || '') ||
        !router ||
        !/^0x[0-9a-fA-F]{40}$/.test(router)
      )
        return {
          data,
          status: 'unsupported',
          message:
            'The returned route is outside the supported Uniswap V2/V3 simulation coverage or has no established router. Its raw result is retained, but not used for the verdict or taxes.',
        };
      const simulation = obj(data.simulationResult);
      if (
        data.simulationSuccess === true &&
        num(simulation.buyGas) === 0 &&
        num(simulation.sellGas) === 0
      )
        return {
          data,
          status: 'unsupported',
          message:
            'The provider reported success without executed buy or sell gas. The inconsistent result is retained without treating it as a completed trading test.',
        };
      return {
        data,
        status: data.simulationSuccess === true ? 'ok' : 'partial',
        message:
          data.simulationSuccess === false
            ? 'Simulation did not complete; a separate honeypot result may still exist.'
            : undefined,
      };
    });
  }
  dex(input: ScanInput) {
    return this.run('dexscreener', async () => {
      const data = arr(
        await this.request(
          new URL(
            `https://api.dexscreener.com/token-pairs/v1/${NETWORKS[input.chainId].dexId}/${input.address}`,
          ),
          'dexscreener',
        ),
      )
        .filter((v) => {
          const p = obj(v);
          return (
            p.chainId === NETWORKS[input.chainId].dexId &&
            [str(obj(p.baseToken).address), str(obj(p.quoteToken).address)].some(
              (a) => a?.toLowerCase() === input.address.toLowerCase(),
            )
          );
        })
        .slice(0, 100);
      return {
        data,
        status: data.length ? 'ok' : 'unsupported',
        message: data.length ? undefined : 'No indexed trading pools were returned for this token.',
      };
    });
  }
  etherscan(input: ScanInput) {
    return this.run('etherscan', async () => {
      if (!this.config.ETHERSCAN_API_KEY)
        throw new ProviderError(
          'Etherscan API key is not configured; source and deployment checks are unavailable.',
          'not_configured',
        );
      const get = async (action: string, extra: Record<string, string>) => {
        const url = new URL('https://api.etherscan.io/v2/api');
        for (const [k, v] of Object.entries({
          chainid: input.chainId,
          module: 'contract',
          action,
          apikey: this.config.ETHERSCAN_API_KEY,
          ...extra,
        }))
          url.searchParams.set(k, v);
        const envelope = obj(await this.request(url, 'etherscan'));
        if (envelope.status !== '1')
          throw new ProviderError(
            'Etherscan returned no data; check the key, chain access, and provider quota.',
          );
        return arr(envelope.result);
      };
      const source = obj((await get('getsourcecode', { address: input.address }))[0]);
      if (!Object.keys(source).length)
        throw new ProviderError('Etherscan returned an empty source record.', 'unsupported');
      let creation: unknown = null,
        creationMessage: string | undefined;
      try {
        creation =
          (await get('getcontractcreation', { contractaddresses: input.address }))[0] || null;
      } catch {
        creationMessage = 'Deployment metadata could not be retrieved.';
      }
      let implementationSource: unknown = null;
      const implementation = str(source.Implementation);
      if (implementation && /^0x[0-9a-fA-F]{40}$/.test(implementation)) {
        try {
          implementationSource =
            (await get('getsourcecode', { address: implementation }))[0] || null;
        } catch {
          /* Report implementation-source gap independently. */
        }
      }
      return {
        data: { source, creation, implementationSource },
        status: creationMessage ? 'partial' : 'ok',
        message: creationMessage,
      };
    });
  }
  coingecko(input: ScanInput) {
    return this.run('coingecko', async () => {
      const pro = this.config.COINGECKO_API_TIER === 'pro';
      if (pro && !this.config.COINGECKO_API_KEY)
        throw new ProviderError('CoinGecko Pro requires a configured API key.', 'not_configured');
      const origin = pro ? 'https://pro-api.coingecko.com' : 'https://api.coingecko.com';
      const headers = this.config.COINGECKO_API_KEY
        ? { [pro ? 'x-cg-pro-api-key' : 'x-cg-demo-api-key']: this.config.COINGECKO_API_KEY }
        : {};
      const prefix = `${origin}/api/v3/coins/${NETWORKS[input.chainId].geckoId}/contract/${input.address}`;
      const metadata = obj(await this.request(new URL(prefix), 'coingecko', headers));
      if (!str(metadata.id))
        throw new ProviderError('No CoinGecko project metadata is available.', 'unsupported');
      const platform = str(obj(metadata.platforms)[NETWORKS[input.chainId].geckoId]);
      if (platform && platform.toLowerCase() !== input.address.toLowerCase())
        throw new ProviderError(
          'CoinGecko metadata does not match this token and network.',
          'unsupported',
        );
      let chart: unknown = null;
      try {
        const url = new URL(prefix + '/market_chart');
        url.searchParams.set('vs_currency', 'usd');
        url.searchParams.set('days', '7');
        chart = await this.request(url, 'coingecko', headers);
      } catch {
        /* Metadata is still useful with explicit partial chart coverage. */
      }
      return {
        data: { metadata, chart },
        status: chart ? 'ok' : 'partial',
        message: chart
          ? undefined
          : 'Project metadata is available; historical prices are unavailable.',
      };
    });
  }
  rpc(input: ScanInput) {
    return this.run('rpc', async () => {
      const client = createPublicClient({
        transport: http(this.config[NETWORKS[input.chainId].rpcEnv], {
          timeout: this.config.PROVIDER_TIMEOUT_MS,
          retryCount: 1,
          fetchOptions: { signal: AbortSignal.timeout(60000) },
          maxResponseBodySize: 2_000_000,
        }),
      });
      const [chainId, block] = await Promise.all([client.getChainId(), client.getBlockNumber()]);
      const code = await client.getBytecode({
        address: input.address as `0x${string}`,
        blockNumber: block,
      });
      if (String(chainId) !== input.chainId)
        throw new ProviderError('RPC endpoint returned a different network.', 'unsupported');
      if (!code || code === '0x')
        return {
          data: {
            isContract: false,
            blockNumber: block.toString(),
            events: [],
            fromBlock: null,
            toBlock: block.toString(),
            historyComplete: false,
            historyNote: 'No deployed bytecode at the scanned address.',
          },
          status: 'partial',
          message: 'The selected address has no deployed contract bytecode.',
        };
      const address = input.address as `0x${string}`;
      const abi = parseAbi([
        'function owner() view returns (address)',
        'function name() view returns (string)',
        'function symbol() view returns (string)',
        'function totalSupply() view returns (uint256)',
        'function decimals() view returns (uint8)',
      ]);
      const reads = await Promise.allSettled([
        client.readContract({ address, abi, functionName: 'owner', blockNumber: block }),
        client.readContract({ address, abi, functionName: 'name', blockNumber: block }),
        client.readContract({ address, abi, functionName: 'symbol', blockNumber: block }),
        client.readContract({ address, abi, functionName: 'totalSupply', blockNumber: block }),
        client.readContract({ address, abi, functionName: 'decimals', blockNumber: block }),
        client.getStorageAt({
          address,
          slot: '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc',
          blockNumber: block,
        }),
      ]);
      const read = (i: number) => {
        const r = reads[i];
        return r?.status === 'fulfilled' ? r.value : null;
      };
      const storage = read(5);
      const impl =
        typeof storage === 'string' && storage.length === 66 ? `0x${storage.slice(-40)}` : null;
      const cursor = (
        await this.db.pool.query(
          'SELECT to_block FROM event_cursors WHERE chain_id=$1 AND address=$2',
          [input.chainId, input.address.toLowerCase()],
        )
      ).rows[0];
      const floor =
        block > BigInt(this.config.RPC_LOG_LOOKBACK)
          ? block - BigInt(this.config.RPC_LOG_LOOKBACK)
          : 0n;
      const cursorBlock = cursor ? BigInt(cursor.to_block) : null;
      const fromBlock =
        cursorBlock !== null && cursorBlock >= floor && cursorBlock < block
          ? cursorBlock + 1n
          : floor;
      const events: unknown[] = [];
      let historyComplete = true,
        historyNote =
          cursorBlock !== null && cursorBlock < floor
            ? 'Indexer resumed after a gap; this is a bounded event history.'
            : 'A bounded recent-block event index, not a complete lifetime history.';
      const controlEvents = [
        parseAbiItem(
          'event OwnershipTransferred(address indexed previousOwner,address indexed newOwner)',
        ),
        parseAbiItem(
          'event RoleGranted(bytes32 indexed role,address indexed account,address indexed sender)',
        ),
        parseAbiItem(
          'event RoleRevoked(bytes32 indexed role,address indexed account,address indexed sender)',
        ),
        parseAbiItem('event Upgraded(address indexed implementation)'),
      ];
      const transfer = parseAbiItem(
        'event Transfer(address indexed from,address indexed to,uint256 value)',
      );
      try {
        for (let start = fromBlock; start <= block; start += BigInt(this.config.RPC_LOG_CHUNK)) {
          const end =
            start + BigInt(this.config.RPC_LOG_CHUNK) - 1n < block
              ? start + BigInt(this.config.RPC_LOG_CHUNK) - 1n
              : block;
          const logs = await Promise.all([
            client.getLogs({ address, events: controlEvents, fromBlock: start, toBlock: end }),
            client.getLogs({
              address,
              event: transfer,
              args: { from: zeroAddress },
              fromBlock: start,
              toBlock: end,
            }),
            client.getLogs({
              address,
              event: transfer,
              args: { to: zeroAddress },
              fromBlock: start,
              toBlock: end,
            }),
          ]);
          for (const log of logs.flat().slice(0, 500)) {
            const args = obj(log.args);
            let timestamp: string | null = null;
            if (events.length < 25 && log.blockNumber !== null) {
              try {
                const b = await client.getBlock({ blockNumber: log.blockNumber });
                timestamp = new Date(Number(b.timestamp) * 1000).toISOString();
              } catch {
                /* Block references remain verifiable without a timestamp. */
              }
            }
            events.push({
              id: `${log.transactionHash}:${log.logIndex}`,
              event: log.eventName,
              args: json(args),
              blockNumber: log.blockNumber?.toString(),
              transactionHash: log.transactionHash,
              timestamp,
            });
          }
          if (logs.flat().length > 500) {
            historyComplete = false;
            historyNote =
              'The event response exceeded the recorded limit; some events in this range are omitted.';
          }
        }
      } catch {
        historyComplete = false;
        historyNote =
          'Some event queries failed; contract state is available but event coverage is incomplete.';
      }
      for (const event of events) {
        const e = obj(event);
        await this.db.pool.query(
          'INSERT INTO token_events(chain_id,address,id,body) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING',
          [input.chainId, input.address.toLowerCase(), e.id, JSON.stringify(e)],
        );
      }
      if (historyComplete)
        await this.db.pool.query(
          'INSERT INTO event_cursors(chain_id,address,to_block) VALUES ($1,$2,$3) ON CONFLICT(chain_id,address) DO UPDATE SET to_block=EXCLUDED.to_block',
          [input.chainId, input.address.toLowerCase(), block.toString()],
        );
      const saved = (
        await this.db.pool.query(
          "SELECT body FROM token_events WHERE chain_id=$1 AND address=$2 ORDER BY (body->>'blockNumber')::numeric DESC LIMIT 100",
          [input.chainId, input.address.toLowerCase()],
        )
      ).rows.map((r) => r.body);
      return {
        data: {
          isContract: true,
          blockNumber: block.toString(),
          owner: read(0),
          name: read(1),
          symbol: read(2),
          totalSupply: read(3),
          decimals: read(4),
          implementation: impl && impl.toLowerCase() !== zeroAddress ? getAddress(impl) : null,
          events: saved,
          fromBlock: fromBlock.toString(),
          toBlock: block.toString(),
          historyComplete,
          historyNote,
        },
        status: historyComplete ? 'ok' : 'partial',
        message: historyComplete ? undefined : historyNote,
      };
    });
  }
  async resolvePair(chainId: ScanInput['chainId'], pair: string) {
    const envelope = obj(
      await this.request(
        new URL(`https://api.dexscreener.com/latest/dex/pairs/${NETWORKS[chainId].dexId}/${pair}`),
        'dexscreener',
      ),
    );
    const found = arr(envelope.pairs)
      .map(obj)
      .find(
        (p) =>
          p.chainId === NETWORKS[chainId].dexId &&
          str(p.pairAddress)?.toLowerCase() === pair.toLowerCase(),
      );
    const address = str(obj(found?.baseToken).address);
    if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address))
      throw new ProviderError('This pool could not be resolved on the selected network.');
    return {
      chainId,
      address: getAddress(address),
      pairAddress: getAddress(pair),
      symbol: str(obj(found?.baseToken).symbol),
      quoteSymbol: str(obj(found?.quoteToken).symbol),
    };
  }
}
