import { describe, it, expect } from 'vitest';
import {
  scanSchema,
  watchSchema,
  explorerLink,
  safeUrl,
  compareReports,
} from '@coinchecker/shared';
import { actionableChanges } from '../apps/api/src/scan-service';
import { report, TOKEN, POOL } from './fixtures';
describe('identity, URLs, and comparisons', () => {
  it('rejects malformed addresses, invalid mixed-case checksums, unsupported chains and surplus fields', () => {
    for (const input of [
      { chainId: '1', address: 'bad' },
      { chainId: '56', address: TOKEN },
      { chainId: '1', address: TOKEN, wallet: 'anything' },
      { chainId: '1', address: '0xa0b86991c6218b36c1d19d4a2e9Eb0cE3606eB48' },
    ])
      expect(scanSchema.safeParse(input).success).toBe(false);
    expect(watchSchema.parse({ chainId: '8453', address: TOKEN }).intervalMinutes).toBe(15);
  });
  it('generates contract links only from the network registry', () => {
    expect(explorerLink('8453', 'address', TOKEN)).toBe(`https://basescan.org/address/${TOKEN}`);
    expect(() => explorerLink('1', 'tx', 'https://evil.example')).toThrow();
    for (const v of [
      'javascript:alert(1)',
      'data:text/html,hi',
      'http://example.com',
      'https://user:pass@example.com',
    ])
      expect(safeUrl(v)).toBeNull();
  });
  it('requires the same chain, token and pool', () => {
    const a = report();
    expect(() => compareReports(a, { ...a, chainId: '1' })).toThrow();
    expect(() => compareReports(a, { ...a, pairAddress: POOL })).toThrow();
  });
  it('does not interpret missing values as resolved or changed facts', () => {
    const a = report();
    a.metrics.sellTax = 30;
    const b = structuredClone(a);
    b.metrics.sellTax = null;
    b.findings = [];
    expect(compareReports(a, b)).toEqual([]);
  });
  it('compares pool liquidity only when the selected pool matches', () => {
    const a = report(),
      b = structuredClone(a);
    b.selectedPair!.liquidityUsd = 50000;
    expect(
      actionableChanges(a, b, { taxThreshold: 10, liquidityDropPercent: 30 }).some(
        (c) => c.field === 'liquidity',
      ),
    ).toBe(true);
    b.selectedPair!.address = TOKEN;
    expect(
      actionableChanges(a, b, { taxThreshold: 10, liquidityDropPercent: 30 }).some(
        (c) => c.field === 'liquidity',
      ),
    ).toBe(false);
  });
  it('alerts on tax thresholds, changed implementation and lost coverage', () => {
    const a = report(),
      b = structuredClone(a);
    a.contract.implementation = POOL;
    b.contract.implementation = TOKEN;
    b.metrics.sellTax = 20;
    b.sources[0]!.status = 'unavailable';
    const c = actionableChanges(a, b, { taxThreshold: 10, liquidityDropPercent: 30 });
    expect(c.map((x) => x.field)).toEqual(
      expect.arrayContaining(['sellTax', 'implementation', 'coverage:goplus']),
    );
  });
});
