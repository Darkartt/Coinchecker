import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { Providers } from '../../apps/api/src/providers';
import { Database } from '../../apps/api/src/database';
import { settings } from '../../apps/api/src/config';
import { sources, input, source, POOL } from '../fixtures';
import type { Report, Watch, Alert } from '@coinchecker/shared';
import type { bootstrap } from '../../apps/api/src/main';
let server: Awaited<ReturnType<typeof bootstrap>>,
  origin: string,
  device: { id: string; token: string },
  stranger: { id: string; token: string },
  first: Report,
  watch: Watch;
let tax = 0,
  fail = false;
const reportIds: string[] = [];
async function call(path: string, token?: string, method = 'GET', body?: unknown) {
  return fetch(origin + '/api/v1' + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
beforeAll(async () => {
  process.env.COINCHECKER_TEST_MODE = '1';
  const { bootstrap } = await import('../../apps/api/src/main');
  server = await bootstrap(0);
  server.monitor.stop();
  origin = await server.app.getUrl();
  origin = origin.replace('0.0.0.0', '127.0.0.1');
  const p = server.app.get(Providers);
  p.goplus = async () => sources()[0]!;
  p.dex = async () => sources()[2]!;
  p.etherscan = async () => sources()[3]!;
  p.coingecko = async () => sources()[4]!;
  p.rpc = async () => sources()[5]!;
  p.honeypot = async () => {
    if (fail) throw new Error('fixture provider failure');
    const h = sources()[1]!.data as any;
    return source('honeypot', {
      ...h,
      simulationResult: { buyTax: 0, sellTax: tax, buyGas: 100000, sellGas: 110000 },
    });
  };
  await server.db.redis.del(
    server.app.get((await import('../../apps/api/src/scan-service')).ScanService).cacheKey(input),
  );
  device = await (await call('/devices', undefined, 'POST', {})).json();
  stranger = await (await call('/devices', undefined, 'POST', {})).json();
}, 45000);
afterAll(async () => {
  if (!server) return;
  for (const d of [device, stranger]) if (d) await server.db.deleteDevice(d.id);
  await server.db.pool.query('DELETE FROM reports WHERE id=ANY($1::uuid[])', [reportIds]);
  await server.shutdown();
});
describe.sequential(
  'real PostgreSQL/Redis API integration with deterministic provider fixtures',
  () => {
    it('requires bearer authorization and rejects malformed requests', async () => {
      expect((await call('/watches')).status).toBe(401);
      expect(
        (await call('/scans', device.token, 'POST', { ...input, address: 'bad' })).status,
      ).toBe(400);
      expect(
        (await call('/scans', device.token, 'POST', { ...input, pairAddress: input.address }))
          .status,
      ).toBe(400);
    });
    it('persists evidence and caches immutable reports without sharing private access', async () => {
      const response = await call('/scans', device.token, 'POST', input);
      expect(response.status).toBe(201);
      first = await response.json();
      reportIds.push(first.id);
      expect(first.verdict).toBe('no_major_issues');
      const cached = await (await call('/scans', device.token, 'POST', input)).json();
      expect(cached.id).toBe(first.id);
      expect((await call(`/reports/${first.id}`, stranger.token)).status).toBe(404);
      expect((await call(`/reports/${first.id}/evidence`, device.token)).status).toBe(200);
      const history = await (
        await call('/history?' + new URLSearchParams(input), device.token)
      ).json();
      expect(history[0].id).toBe(first.id);
    });
    it('survives a separate database connection, stores only a token hash', async () => {
      const db = new Database(settings);
      await db.initialize();
      try {
        expect((await db.report(device.id, first.id))?.id).toBe(first.id);
        const row = (await db.pool.query('SELECT token_hash FROM devices WHERE id=$1', [device.id]))
          .rows[0];
        expect(row.token_hash).toBe(db.hash(device.token));
        expect(row.token_hash).not.toBe(device.token);
      } finally {
        await db.close();
      }
    });
    it('stores watch settings privately with the latest scan baseline', async () => {
      watch = await (
        await call('/watches', device.token, 'POST', {
          ...input,
          label: 'Fixture watch',
          intervalMinutes: 5,
          taxThreshold: 10,
          liquidityDropPercent: 30,
        })
      ).json();
      expect(watch.lastReport?.id).toBe(first.id);
      expect(await (await call('/watches', stranger.token)).json()).toEqual([]);
      expect((await call(`/watches/${watch.id}`, stranger.token, 'DELETE')).status).toBe(404);
    });
    it('monitors changes, persists alerts and compares owner-authorized snapshots', async () => {
      tax = 25;
      await server.db.redis.del(
        server.app
          .get((await import('../../apps/api/src/scan-service')).ScanService)
          .cacheKey(input),
      );
      await server.db.pool.query('UPDATE watches SET next_check_at=now() WHERE id=$1', [watch.id]);
      await server.monitor.tick();
      const alerts = (await (await call('/alerts', device.token)).json()) as Alert[];
      expect(alerts.length).toBe(1);
      expect(alerts[0]!.changes.some((c) => c.field === 'sellTax')).toBe(true);
      reportIds.push(alerts[0]!.reportId);
      const compare = await (
        await call(`/compare?previous=${first.id}&current=${alerts[0]!.reportId}`, device.token)
      ).json();
      expect(compare.changes.some((c: any) => c.field === 'sellTax')).toBe(true);
      expect((await call(`/alerts/${alerts[0]!.id}`, stranger.token, 'PATCH', {})).status).toBe(
        404,
      );
      expect((await call(`/alerts/${alerts[0]!.id}`, device.token, 'PATCH', {})).status).toBe(200);
      expect((await (await call('/alerts', device.token)).json())[0].read).toBe(true);
    });
    it('retains the previous report and records a monitoring error on failure', async () => {
      fail = true;
      await server.db.redis.del(
        server.app
          .get((await import('../../apps/api/src/scan-service')).ScanService)
          .cacheKey(input),
      );
      await server.db.pool.query('UPDATE watches SET next_check_at=now() WHERE id=$1', [watch.id]);
      await server.monitor.tick();
      const rows = await (await call('/watches', device.token)).json();
      expect(rows[0].lastError).toContain('could not complete');
      expect(rows[0].lastReport.metrics.sellTax).toBe(25);
      fail = false;
    });
    it('limits writes and removes private installation data', async () => {
      const window = Math.floor(Date.now() / 60000);
      await server.db.redis.set(`rate:write:${stranger.id}:${window}`, '15', { EX: 70 });
      expect((await call('/scans', stranger.token, 'POST', input)).status).toBe(429);
      expect((await call('/device', device.token, 'DELETE')).status).toBe(200);
      expect((await call('/watches', device.token)).status).toBe(401);
      expect(
        (await server.db.pool.query('SELECT id FROM watches WHERE device_id=$1', [device.id])).rows,
      ).toEqual([]);
      expect(
        (await server.db.pool.query('SELECT id FROM alerts WHERE device_id=$1', [device.id])).rows,
      ).toEqual([]);
    });
  },
);
