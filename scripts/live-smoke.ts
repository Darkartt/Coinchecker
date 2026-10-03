import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import type { Report } from '@coinchecker/shared';
const origin = process.env.API_URL || 'http://localhost:3001';
async function call(path: string, token?: string, method = 'GET', body?: unknown) {
  return fetch(origin + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(120000),
  });
}
const ready = await call('/health/ready');
assert.equal(ready.status, 200);
const device = await (await call('/api/v1/devices', undefined, 'POST', {})).json();
const stranger = await (await call('/api/v1/devices', undefined, 'POST', {})).json();
const results: unknown[] = [];
try {
  for (const input of [
    { chainId: '8453', address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' },
    { chainId: '1', address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' },
  ]) {
    console.log(`Live scan: ${input.chainId} ${input.address}`);
    const response = await call('/api/v1/scans', device.token, 'POST', input);
    assert.equal(response.status, 201, await response.clone().text());
    const report = (await response.json()) as Report;
    assert.equal(report.chainId, input.chainId);
    assert.equal(report.address.toLowerCase(), input.address.toLowerCase());
    assert.equal(report.sources.length, 6);
    assert.ok(
      report.sources.some((s) => s.source === 'dexscreener' && s.status === 'ok'),
      'Live market coverage',
    );
    assert.ok(
      report.sources.some((s) => s.source === 'goplus' && s.status === 'ok'),
      'Live GoPlus coverage',
    );
    const cached = await (await call('/api/v1/scans', device.token, 'POST', input)).json();
    assert.equal(cached.id, report.id, 'Cache returns the same recorded snapshot');
    assert.equal(
      (await call(`/api/v1/reports/${report.id}`, stranger.token)).status,
      404,
      'Other installations cannot read private report access',
    );
    const history = await (
      await call('/api/v1/history?' + new URLSearchParams(input), device.token)
    ).json();
    assert.ok(history.some((r: Report) => r.id === report.id));
    results.push({
      chainId: report.chainId,
      address: report.address,
      verdict: report.verdict,
      coverage: report.coverage,
      sources: report.sources.map((s) => ({
        source: s.source,
        status: s.status,
        message: s.message,
        durationMs: s.durationMs,
      })),
      pairs: report.pairs.length,
      events: report.history.length,
    });
    console.log(JSON.stringify(results.at(-1)));
  }
  assert.equal(
    (await call('/api/v1/scans', device.token, 'POST', { chainId: '8453', address: 'bad' })).status,
    400,
  );
  await mkdir('artifacts', { recursive: true });
  await writeFile(
    'artifacts/live-smoke.json',
    JSON.stringify({ checkedAt: new Date().toISOString(), results }, null, 2),
  );
  console.log('Live API smoke checks passed.');
} finally {
  await call('/api/v1/device', device.token, 'DELETE');
  await call('/api/v1/device', stranger.token, 'DELETE');
}
