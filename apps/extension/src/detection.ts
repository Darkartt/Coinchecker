import { getAddress, isAddress } from 'viem';
import type { ChainId } from '@coinchecker/shared';
export interface Detection {
  chainId: ChainId;
  address: `0x${string}`;
  kind: 'token' | 'pool';
  source: string;
}
export const SUPPORTED_ORIGINS = [
  'https://etherscan.io/*',
  'https://basescan.org/*',
  'https://dexscreener.com/*',
  'https://app.uniswap.org/*',
];
export function detectFromUrl(value: string): Detection | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  const valid = (candidate: string | undefined | null) =>
    candidate && isAddress(candidate) ? getAddress(candidate) : null;
  if (url.hostname === 'etherscan.io' || url.hostname === 'basescan.org') {
    const address = valid(
      url.pathname.match(/^\/(?:token|address)\/(0x[0-9a-fA-F]{40})(?:\/|$)/)?.[1],
    );
    return address
      ? {
          chainId: url.hostname === 'etherscan.io' ? '1' : '8453',
          address,
          kind: 'token',
          source: url.hostname,
        }
      : null;
  }
  if (url.hostname === 'dexscreener.com') {
    const match = url.pathname.match(/^\/(ethereum|base)\/(0x[0-9a-fA-F]{40})\/?$/i),
      address = valid(match?.[2]);
    return address
      ? {
          chainId: match![1]!.toLowerCase() === 'base' ? '8453' : '1',
          address,
          kind: 'pool',
          source: 'DEX Screener',
        }
      : null;
  }
  if (url.hostname === 'app.uniswap.org') {
    const chain =
      url.searchParams.get('chain') || url.pathname.match(/\/tokens\/(ethereum|base)\//)?.[1];
    const chainId =
      chain === 'ethereum' || chain === '1'
        ? '1'
        : chain === 'base' || chain === '8453'
          ? '8453'
          : null;
    const candidate =
      url.pathname.match(/\/tokens\/(?:ethereum|base)\/(0x[0-9a-fA-F]{40})/)?.[1] ||
      url.searchParams.get('outputCurrency');
    const address = valid(candidate);
    return chainId && address ? { chainId, address, kind: 'token', source: 'Uniswap' } : null;
  }
  return null;
}
export async function detectActiveTab(): Promise<Detection | null> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  if (!tab?.url) return null;
  return detectFromUrl(tab.url);
}
