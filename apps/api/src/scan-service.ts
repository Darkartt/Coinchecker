import { createHash, randomUUID } from 'node:crypto';
import { BadRequestException, HttpException } from '@nestjs/common';
import { isAddress, getAddress } from 'viem';
import {
  RULES_VERSION,
  compareReports,
  type ScanInput,
  type Report,
  type Change,
  type Watch,
} from '@coinchecker/shared';
import type { Database } from './database.js';
import type { Providers } from './providers.js';
import { arr, obj, str, num } from './providers.js';
import { analyze } from './analyzer.js';

export class ScanService {
  constructor(
    readonly db: Database,
    readonly providers: Providers,
  ) {}
  cacheKey(input: ScanInput) {
    const c = this.providers.config;
    const coverage = createHash('sha256')
      .update(
        JSON.stringify({
          honeypot: c.NODE_ENV !== 'production' || c.HONEYPOT_PRODUCTION_PERMISSION === 'true',
          etherscan: !!c.ETHERSCAN_API_KEY,
          coingeckoTier: c.COINGECKO_API_TIER,
          coingeckoKey: !!c.COINGECKO_API_KEY,
          goplusKey: !!c.GOPLUS_ACCESS_TOKEN,
          honeypotKey: !!c.HONEYPOT_API_KEY,
          ethereumRpc: c.ETHEREUM_RPC_URL,
          baseRpc: c.BASE_RPC_URL,
          logLookback: c.RPC_LOG_LOOKBACK,
          logChunk: c.RPC_LOG_CHUNK,
        }),
      )
      .digest('hex')
      .slice(0, 16);
    return `scan:${RULES_VERSION}:${coverage}:${input.chainId}:${input.address.toLowerCase()}:${(input.pairAddress || 'auto').toLowerCase()}`;
  }
  async scan(deviceId: string, input: ScanInput): Promise<Report> {
    const cacheKey = this.cacheKey(input);
    if (!input.refresh) {
      const cached = await this.db.redis.get(cacheKey);
      if (cached) {
        const report = JSON.parse(cached) as Report;
        await this.db.attachReport(deviceId, report);
        return report;
      }
    }
    const lockKey = `lock:${cacheKey}`,
      lock = randomUUID();
    if (!(await this.db.redis.set(lockKey, lock, { NX: true, EX: 120 })))
      throw new HttpException('This token is already being scanned. Try again shortly.', 429);
    try {
      const other = [
        this.providers.goplus(input),
        this.providers.etherscan(input),
        this.providers.coingecko(input),
        this.providers.rpc(input),
      ];
      const dex = await this.providers.dex(input);
      const pairs = arr(dex.data)
        .map(obj)
        .sort((a, b) => (num(obj(b.liquidity).usd) || 0) - (num(obj(a.liquidity).usd) || 0));
      if (
        input.pairAddress &&
        !pairs.some((p) => str(p.pairAddress)?.toLowerCase() === input.pairAddress!.toLowerCase())
      ) {
        await Promise.allSettled(other);
        throw new BadRequestException(
          'The selected pool could not be verified for this token on this network. Choose automatic pool selection or retry when market coverage is available.',
        );
      }
      const candidate = input.pairAddress || str(pairs[0]?.pairAddress);
      const chosen = candidate && isAddress(candidate) ? getAddress(candidate) : undefined;
      const honeypot = await this.providers.honeypot({ ...input, pairAddress: chosen });
      const [goplus, etherscan, coingecko, rpc] = await Promise.all(other);
      const report = analyze(
        input,
        [goplus!, honeypot, dex, etherscan!, coingecko!, rpc!],
        this.providers.config.SCAN_CACHE_SECONDS,
      );
      await this.db.attachReport(deviceId, report);
      await this.db.redis.set(cacheKey, JSON.stringify(report), {
        EX: this.providers.config.SCAN_CACHE_SECONDS,
      });
      return report;
    } finally {
      await this.db.redis.eval(
        'if redis.call("get",KEYS[1]) == ARGV[1] then return redis.call("del",KEYS[1]) else return 0 end',
        { keys: [lockKey], arguments: [lock] },
      );
    }
  }
}

export function actionableChanges(
  previous: Report,
  current: Report,
  watch: Pick<Watch, 'taxThreshold' | 'liquidityDropPercent'>,
): Change[] {
  return compareReports(previous, current).filter((change) => {
    if (change.field === 'liquidity') {
      const before = Number(change.before),
        after = Number(change.after);
      return (
        before > 0 &&
        after < before &&
        ((before - after) / before) * 100 >= watch.liquidityDropPercent
      );
    }
    if (change.field === 'sellTax' || change.field === 'buyTax')
      return (
        Number(change.after) >= watch.taxThreshold && Number(change.after) > Number(change.before)
      );
    return ['critical', 'high', 'caution', 'unknown'].includes(change.severity);
  });
}
export class Monitor {
  private timer: ReturnType<typeof setInterval> | undefined;
  private running = false;
  constructor(
    readonly db: Database,
    readonly scans: ScanService,
  ) {}
  start() {
    this.timer = setInterval(() => {
      void this.tick().catch(() => {
        /* Readiness and watch last_error surface failure without logging private tokens. */
      });
    }, this.scans.providers.config.MONITOR_INTERVAL_SECONDS * 1000);
    this.timer.unref();
  }
  stop() {
    if (this.timer) clearInterval(this.timer);
  }
  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      const rows = (
        await this.db.pool.query(
          `WITH due AS (SELECT id FROM watches WHERE next_check_at<=now() ORDER BY next_check_at LIMIT 10 FOR UPDATE SKIP LOCKED) UPDATE watches w SET next_check_at=now()+make_interval(mins=>w.interval_minutes) FROM due WHERE w.id=due.id RETURNING w.*`,
        )
      ).rows;
      for (const row of rows) {
        try {
          const previous = row.last_report_id
            ? await this.db.report(row.device_id, row.last_report_id)
            : null;
          const report = await this.scans.scan(row.device_id, {
            chainId: row.chain_id,
            address: row.address,
            pairAddress: row.pair_address || undefined,
            refresh: false,
          });
          const changes =
            previous && previous.id !== report.id
              ? actionableChanges(previous, report, {
                  taxThreshold: Number(row.tax_threshold),
                  liquidityDropPercent: Number(row.liquidity_drop),
                })
              : [];
          await this.db.pool.query(
            'UPDATE watches SET last_report_id=$1,last_error=NULL WHERE id=$2',
            [report.id, row.id],
          );
          if (changes.length)
            await this.db.pool.query(
              'INSERT INTO alerts(device_id,watch_id,report_id,title,changes) VALUES ($1,$2,$3,$4,$5)',
              [
                row.device_id,
                row.id,
                report.id,
                `${report.symbol}: ${changes[0]!.title}`,
                JSON.stringify(changes),
              ],
            );
        } catch {
          await this.db.pool.query('UPDATE watches SET last_error=$1 WHERE id=$2', [
            'Monitoring could not complete this check. The previous report remains available.',
            row.id,
          ]);
        }
      }
    } finally {
      this.running = false;
    }
  }
}
