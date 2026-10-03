import { describe, it, expect } from 'vitest';
import { analyze } from '../apps/api/src/analyzer';
import { input, sources, source, report, POOL } from './fixtures';
describe('evidence-led assessment', () => {
  it('requires established core checks for a no-major-issues verdict', () => {
    expect(report().verdict).toBe('no_major_issues');
    expect(analyze(input, sources({ goplus: { is_open_source: '1' } })).verdict).toBe(
      'insufficient_data',
    );
  });
  it('does not cancel a critical result with verified source and positive market data', () => {
    const r = report({ goplus: { is_honeypot: '1', is_open_source: '1' } });
    expect(r.verdict).toBe('critical');
    expect(r.contract.verified).toBe(true);
    expect(r.evidence.find((e) => e.field === 'is_honeypot')?.value).toBe('1');
  });
  it('distinguishes simulation failure from an independently reported honeypot conclusion', () => {
    const failed = report({
      honeypot: { simulationSuccess: false, simulationError: 'Insufficient liquidity' },
    });
    expect(failed.verdict).toBe('insufficient_data');
    expect(failed.findings.find((f) => f.id === 'simulation_incomplete')?.severity).toBe('unknown');
    expect(
      report({ honeypot: { simulationSuccess: false, honeypotResult: { isHoneypot: true } } })
        .verdict,
    ).toBe('critical');
  });
  it('does not consume an unsupported route result as a tax or honeypot finding', () => {
    const s = sources();
    s[1] = source(
      'honeypot',
      {
        simulationSuccess: true,
        simulationResult: { sellTax: 100 },
        honeypotResult: { isHoneypot: true },
      },
      'unsupported',
    );
    const r = analyze(input, s);
    expect(r.verdict).toBe('insufficient_data');
    expect(r.metrics.sellTax).toBe(0);
    expect(r.findings.some((f) => f.severity === 'critical')).toBe(false);
  });
  it('explains legitimate administrative powers without accusing a token of fraud', () => {
    const r = report({ goplus: { is_mintable: '1', transfer_pausable: '1', is_blacklisted: '1' } });
    expect(r.verdict).toBe('caution');
    expect(r.findings.every((f) => f.severity === 'caution')).toBe(true);
    expect(
      r.findings.every(
        (f) => f.limitations.includes('Legitimate') || f.limitations.includes('intent'),
      ),
    ).toBe(true);
  });
  it('keeps token deployment and pool age separate, and rejects invalid timestamps', () => {
    const r = report({
      etherscan: { source: { SourceCode: 'verified' }, creation: { timestamp: 1e100 } },
    });
    expect(r.contract.deployedAt).toBeNull();
    expect(r.selectedPair?.createdAt).not.toBeNull();
  });
  it('does not apply fungible LP balances to v3 or unmatched pools', () => {
    const s = sources();
    const p = (s[2]!.data as any[])[0];
    p.labels = ['v3'];
    expect(analyze(input, s).metrics.liquidityLockedPercent).toBeNull();
    expect(
      report({
        goplus: {
          dex: [{ pair: '0x5555555555555555555555555555555555555555' }],
          lp_holders: [{ percent: '1', is_locked: '1' }],
        },
      }).metrics.liquidityLockedPercent,
    ).toBeNull();
    expect(report().metrics.liquidityLockedPercent).toBe(100);
  });
  it('does not assign the base token price or valuation to the quote token', () => {
    const s = sources();
    (s[2]!.data as any[])[0].baseToken.address = '0x5555555555555555555555555555555555555555';
    (s[2]!.data as any[])[0].quoteToken.address = input.address;
    (s[2]!.data as any[])[0].fdv = 10000;
    const r = analyze(input, s);
    expect(r.selectedPair?.priceUsd).toBeNull();
    expect(r.selectedPair?.fdv).toBeNull();
  });
  it('records all outages as unavailable coverage without a passed verdict', () => {
    const r = analyze(
      input,
      sources().map((s) => ({ ...s, status: 'unavailable', data: null })),
    );
    expect(r.verdict).toBe('insufficient_data');
    expect(r.coverage.label).toBe('insufficient');
    expect(r.coverage.completed).toBe(0);
  });
  it('keeps untrusted project descriptions as text and rejects executable links', () => {
    const r = report({
      coingecko: {
        metadata: {
          description: { en: '<script>alert(1)</script>hello' },
          links: { homepage: ['javascript:alert(1)', 'https://example.com'] },
        },
      },
    });
    expect(r.project.websites).toEqual(['https://example.com/']);
    expect(r.project.description).not.toContain('<script>');
  });
});
