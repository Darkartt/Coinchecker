import { Pool } from 'pg';
import { createClient } from 'redis';
import { createHash, randomBytes } from 'node:crypto';
import type { Alert, Report, Watch, WatchInput } from '@coinchecker/shared';
import type { Configuration } from './config.js';

const migration = `
CREATE TABLE IF NOT EXISTS devices (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), token_hash text UNIQUE NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS reports (id uuid PRIMARY KEY, chain_id text NOT NULL, address text NOT NULL, pair_address text NOT NULL DEFAULT '', checked_at timestamptz NOT NULL, body jsonb NOT NULL);
CREATE INDEX IF NOT EXISTS reports_token_time ON reports(chain_id,address,pair_address,checked_at DESC);
CREATE TABLE IF NOT EXISTS device_reports (device_id uuid NOT NULL REFERENCES devices(id) ON DELETE CASCADE, report_id uuid NOT NULL REFERENCES reports(id) ON DELETE CASCADE, PRIMARY KEY(device_id,report_id));
CREATE TABLE IF NOT EXISTS watches (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), device_id uuid NOT NULL REFERENCES devices(id) ON DELETE CASCADE, chain_id text NOT NULL, address text NOT NULL, pair_address text NOT NULL DEFAULT '', label text NOT NULL, interval_minutes integer NOT NULL CHECK(interval_minutes BETWEEN 5 AND 1440), tax_threshold numeric NOT NULL, liquidity_drop numeric NOT NULL, last_report_id uuid REFERENCES reports(id), next_check_at timestamptz NOT NULL DEFAULT now(), last_error text, UNIQUE(device_id,chain_id,address,pair_address));
CREATE INDEX IF NOT EXISTS watches_due ON watches(next_check_at);
CREATE TABLE IF NOT EXISTS alerts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), device_id uuid NOT NULL REFERENCES devices(id) ON DELETE CASCADE, watch_id uuid NOT NULL REFERENCES watches(id) ON DELETE CASCADE, report_id uuid NOT NULL REFERENCES reports(id), title text NOT NULL, changes jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), read boolean NOT NULL DEFAULT false);
CREATE INDEX IF NOT EXISTS alerts_owner_time ON alerts(device_id,created_at DESC);
CREATE TABLE IF NOT EXISTS event_cursors (chain_id text NOT NULL,address text NOT NULL,to_block numeric NOT NULL, PRIMARY KEY(chain_id,address));
CREATE TABLE IF NOT EXISTS token_events (chain_id text NOT NULL,address text NOT NULL,id text NOT NULL,body jsonb NOT NULL,PRIMARY KEY(chain_id,address,id));
CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
INSERT INTO schema_migrations(version) VALUES (1) ON CONFLICT DO NOTHING;
`;

export class Database {
  readonly pool: Pool;
  readonly redis: ReturnType<typeof createClient>;
  constructor(config: Configuration) {
    this.pool = new Pool({
      connectionString: config.DATABASE_URL,
      max: 10,
      connectionTimeoutMillis: 5000,
      statement_timeout: 10000,
    });
    this.redis = createClient({ url: config.REDIS_URL, socket: { connectTimeout: 5000 } });
    this.redis.on('error', () => {
      /* Availability is returned by readiness; never log credential-bearing URLs. */
    });
  }
  async initialize() {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(8273401)');
      await client.query(migration);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
    await this.redis.connect();
  }
  async close() {
    if (this.redis.isOpen) await this.redis.quit();
    await this.pool.end();
  }
  async ready() {
    await this.pool.query('SELECT 1');
    await this.redis.ping();
    return true;
  }
  async createDevice() {
    const token = randomBytes(32).toString('base64url');
    const row = (
      await this.pool.query('INSERT INTO devices(token_hash) VALUES ($1) RETURNING id', [
        this.hash(token),
      ])
    ).rows[0];
    return { id: row.id as string, token };
  }
  hash(value: string) {
    return createHash('sha256').update(value).digest('hex');
  }
  async authenticate(token: string) {
    if (!/^[\w-]{43}$/.test(token)) return null;
    return (await this.pool.query('SELECT id FROM devices WHERE token_hash=$1', [this.hash(token)]))
      .rows[0]?.id as string | undefined;
  }
  async attachReport(deviceId: string, report: Report) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        'INSERT INTO reports(id,chain_id,address,pair_address,checked_at,body) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO NOTHING',
        [
          report.id,
          report.chainId,
          report.address.toLowerCase(),
          (report.pairAddress || '').toLowerCase(),
          report.checkedAt,
          JSON.stringify(report),
        ],
      );
      await client.query(
        'INSERT INTO device_reports(device_id,report_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
        [deviceId, report.id],
      );
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }
  async report(deviceId: string, id: string): Promise<Report | null> {
    return (
      (
        await this.pool.query(
          'SELECT r.body FROM reports r JOIN device_reports d ON d.report_id=r.id WHERE d.device_id=$1 AND r.id=$2',
          [deviceId, id],
        )
      ).rows[0]?.body || null
    );
  }
  async history(deviceId: string, chain: string, address: string, pair = ''): Promise<Report[]> {
    return (
      await this.pool.query(
        'SELECT r.body FROM reports r JOIN device_reports d ON d.report_id=r.id WHERE d.device_id=$1 AND r.chain_id=$2 AND r.address=$3 AND r.pair_address=$4 ORDER BY checked_at DESC LIMIT 50',
        [deviceId, chain, address.toLowerCase(), pair.toLowerCase()],
      )
    ).rows.map((r) => r.body);
  }
  async upsertWatch(deviceId: string, input: WatchInput) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT id FROM devices WHERE id=$1 FOR UPDATE', [deviceId]);
      const count = Number(
        (await client.query('SELECT count(*) FROM watches WHERE device_id=$1', [deviceId])).rows[0]
          .count,
      );
      const existing = (
        await client.query(
          'SELECT id FROM watches WHERE device_id=$1 AND chain_id=$2 AND address=$3 AND pair_address=$4',
          [
            deviceId,
            input.chainId,
            input.address.toLowerCase(),
            (input.pairAddress || '').toLowerCase(),
          ],
        )
      ).rows[0];
      if (!existing && count >= 50)
        throw new Error('You can monitor up to 50 tokens per installation.');
      const latest = (
        await client.query(
          'SELECT r.body FROM reports r JOIN device_reports d ON d.report_id=r.id WHERE d.device_id=$1 AND r.chain_id=$2 AND r.address=$3 AND r.pair_address=$4 ORDER BY checked_at DESC LIMIT 1',
          [
            deviceId,
            input.chainId,
            input.address.toLowerCase(),
            (input.pairAddress || '').toLowerCase(),
          ],
        )
      ).rows[0]?.body as Report | undefined;
      const id = (
        await client.query(
          'INSERT INTO watches(device_id,chain_id,address,pair_address,label,interval_minutes,tax_threshold,liquidity_drop,last_report_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(device_id,chain_id,address,pair_address) DO UPDATE SET label=EXCLUDED.label,interval_minutes=EXCLUDED.interval_minutes,tax_threshold=EXCLUDED.tax_threshold,liquidity_drop=EXCLUDED.liquidity_drop RETURNING id',
          [
            deviceId,
            input.chainId,
            input.address.toLowerCase(),
            (input.pairAddress || '').toLowerCase(),
            input.label || latest?.symbol || input.address,
            input.intervalMinutes,
            input.taxThreshold,
            input.liquidityDropPercent,
            latest?.id || null,
          ],
        )
      ).rows[0].id as string;
      await client.query('COMMIT');
      return id;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  async watches(deviceId: string): Promise<Watch[]> {
    const rows = (
      await this.pool.query(
        'SELECT w.*,r.body FROM watches w LEFT JOIN reports r ON r.id=w.last_report_id WHERE w.device_id=$1 ORDER BY w.label',
        [deviceId],
      )
    ).rows;
    return rows.map((r) => ({
      id: r.id,
      chainId: r.chain_id,
      address: r.address,
      pairAddress: r.pair_address || undefined,
      label: r.label,
      intervalMinutes: r.interval_minutes,
      taxThreshold: Number(r.tax_threshold),
      liquidityDropPercent: Number(r.liquidity_drop),
      lastReport: r.body || null,
      nextCheckAt: r.next_check_at.toISOString(),
      lastError: r.last_error,
    }));
  }
  async deleteWatch(deviceId: string, id: string) {
    return (
      await this.pool.query('DELETE FROM watches WHERE device_id=$1 AND id=$2', [deviceId, id])
    ).rowCount;
  }
  async alerts(deviceId: string): Promise<Alert[]> {
    return (
      await this.pool.query(
        'SELECT * FROM alerts WHERE device_id=$1 ORDER BY created_at DESC LIMIT 100',
        [deviceId],
      )
    ).rows.map((r) => ({
      id: r.id,
      watchId: r.watch_id,
      reportId: r.report_id,
      title: r.title,
      changes: r.changes,
      createdAt: r.created_at.toISOString(),
      read: r.read,
    }));
  }
  async markAlert(deviceId: string, id: string) {
    return (
      await this.pool.query('UPDATE alerts SET read=true WHERE device_id=$1 AND id=$2', [
        deviceId,
        id,
      ])
    ).rowCount;
  }
  async deleteDevice(deviceId: string) {
    await this.pool.query('DELETE FROM devices WHERE id=$1', [deviceId]);
  }
}
