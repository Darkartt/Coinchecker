import { describe, it, expect } from 'vitest';
import { detectFromUrl } from '../apps/extension/src/detection';
import { TOKEN, POOL } from './fixtures';
describe('supported-page detection', () => {
  it('uses exact trusted hosts and network-specific routes', () => {
    expect(detectFromUrl(`https://basescan.org/token/${TOKEN}`)?.chainId).toBe('8453');
    expect(detectFromUrl(`https://etherscan.io/token/${TOKEN}`)?.chainId).toBe('1');
    expect(detectFromUrl(`https://etherscan.io.evil.example/token/${TOKEN}`)).toBeNull();
    expect(detectFromUrl(`http://etherscan.io/token/${TOKEN}`)).toBeNull();
  });
  it('distinguishes a pool from a token address', () => {
    expect(detectFromUrl(`https://dexscreener.com/base/${POOL}`)).toMatchObject({
      kind: 'pool',
      chainId: '8453',
      address: POOL,
    });
  });
  it('rejects unsupported chains, websites, and malformed targets', () => {
    for (const u of [
      `https://dexscreener.com/solana/${TOKEN}`,
      'https://basescan.org/token/bad',
      `https://example.com/token/${TOKEN}`,
    ])
      expect(detectFromUrl(u)).toBeNull();
  });
});
