import { z } from 'zod';
import { getAddress, isAddress } from 'viem';

export const RULES_VERSION = '1.0.1';
export const NETWORKS = {
  '1': {
    id: '1',
    name: 'Ethereum',
    dexId: 'ethereum',
    geckoId: 'ethereum',
    explorer: 'https://etherscan.io',
    rpcEnv: 'ETHEREUM_RPC_URL',
  },
  '8453': {
    id: '8453',
    name: 'Base',
    dexId: 'base',
    geckoId: 'base',
    explorer: 'https://basescan.org',
    rpcEnv: 'BASE_RPC_URL',
  },
} as const;
export type ChainId = keyof typeof NETWORKS;
export const addressSchema = z
  .string()
  .trim()
  .refine(
    (value) => isAddress(value, { strict: true }),
    'Enter a valid 42-character EVM address; mixed-case addresses must have a valid checksum.',
  )
  .transform((value) => getAddress(value));
export const scanSchema = z
  .object({
    chainId: z.enum(['1', '8453']),
    address: addressSchema,
    pairAddress: addressSchema.optional(),
    refresh: z.boolean().optional(),
  })
  .strict();
export type ScanInput = z.infer<typeof scanSchema>;
export const watchSchema = scanSchema
  .omit({ refresh: true })
  .extend({
    label: z.string().trim().max(80).optional(),
    intervalMinutes: z.number().int().min(5).max(1440).default(15),
    taxThreshold: z.number().min(0).max(100).default(10),
    liquidityDropPercent: z.number().min(1).max(100).default(30),
  });
export type WatchInput = z.infer<typeof watchSchema>;
export type SourceId = 'goplus' | 'honeypot' | 'dexscreener' | 'etherscan' | 'coingecko' | 'rpc';
export type SourceStatus = 'ok' | 'partial' | 'unavailable' | 'unsupported' | 'not_configured';
export type Severity = 'critical' | 'high' | 'caution' | 'info' | 'unknown';
export type Verdict = 'critical' | 'high' | 'caution' | 'no_major_issues' | 'insufficient_data';
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export interface Evidence {
  id: string;
  source: SourceId;
  field: string;
  value: Json;
  observedAt: string;
  blockNumber?: string;
  url: string;
}
export interface Finding {
  id: string;
  severity: Severity;
  title: string;
  explanation: string;
  limitations: string;
  evidenceIds: string[];
}
export interface ProviderResult {
  source: SourceId;
  status: SourceStatus;
  checkedAt: string;
  durationMs: number;
  message?: string;
  data: Json;
  digest: string;
}
export interface Pair {
  address: string;
  dex: string;
  label: string;
  url: string;
  priceUsd: number | null;
  priceChange24h: number | null;
  liquidityUsd: number | null;
  volume24h: number | null;
  marketCap: number | null;
  fdv: number | null;
  createdAt: string | null;
  baseSymbol: string;
  quoteSymbol: string;
}
export interface TimelineEvent {
  id: string;
  kind: 'onchain' | 'market' | 'observation';
  title: string;
  description: string;
  timestamp: string | null;
  blockNumber?: string;
  transactionHash?: string;
  url?: string;
  source: SourceId;
  details?: Json;
}
export interface Report {
  id: string;
  chainId: ChainId;
  address: string;
  pairAddress?: string;
  name: string;
  symbol: string;
  checkedAt: string;
  expiresAt: string;
  rulesVersion: string;
  verdict: Verdict;
  coverage: {
    label: 'complete' | 'partial' | 'insufficient';
    completed: number;
    total: number;
    limitations: string[];
  };
  findings: Finding[];
  evidence: Evidence[];
  sources: ProviderResult[];
  pairs: Pair[];
  selectedPair: Pair | null;
  contract: {
    verified: boolean | null;
    implementation: string | null;
    owner: string | null;
    isContract: boolean | null;
    deployedAt: string | null;
    creator: string | null;
    deploymentTx: string | null;
    audit: 'not_established';
    compiler: string | null;
  };
  history: TimelineEvent[];
  historyCoverage: {
    fromBlock: string | null;
    toBlock: string | null;
    complete: boolean;
    note: string;
  };
  project: {
    description: string | null;
    websites: string[];
    repositories: string[];
    logo: string | null;
    provenance: string;
    prices: [number, number][];
  };
  metrics: {
    buyTax: number | null;
    sellTax: number | null;
    holderCount: number | null;
    topHolderPercent: number | null;
    liquidityLockedPercent: number | null;
  };
}
export interface Change {
  field: string;
  title: string;
  before: Json;
  after: Json;
  severity: Severity;
}
export interface Watch {
  id: string;
  chainId: ChainId;
  address: string;
  pairAddress?: string;
  label: string;
  intervalMinutes: number;
  taxThreshold: number;
  liquidityDropPercent: number;
  lastReport: Report | null;
  nextCheckAt: string;
  lastError: string | null;
}
export interface Alert {
  id: string;
  watchId: string;
  reportId: string;
  title: string;
  changes: Change[];
  createdAt: string;
  read: boolean;
}
export const VERDICT_LABELS: Record<Verdict, string> = {
  critical: 'Critical finding',
  high: 'High risk',
  caution: 'Caution',
  no_major_issues: 'No major issues detected',
  insufficient_data: 'Insufficient data',
};
export const SOURCE_LABELS: Record<SourceId, string> = {
  goplus: 'GoPlus',
  honeypot: 'Honeypot.is',
  dexscreener: 'DEX Screener',
  etherscan: 'Etherscan',
  coingecko: 'CoinGecko',
  rpc: 'On-chain RPC',
};
export function explorerLink(
  chainId: ChainId,
  kind: 'address' | 'tx' | 'block',
  value: string,
): string {
  const valid =
    kind === 'address'
      ? isAddress(value)
      : kind === 'tx'
        ? /^0x[0-9a-fA-F]{64}$/.test(value)
        : /^\d+$/.test(value);
  if (!valid) throw new Error('Invalid explorer reference');
  return `${NETWORKS[chainId].explorer}/${kind}/${encodeURIComponent(value)}`;
}
export function safeUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}
export function compareReports(previous: Report, current: Report): Change[] {
  if (
    previous.chainId !== current.chainId ||
    previous.address.toLowerCase() !== current.address.toLowerCase() ||
    (previous.pairAddress || '').toLowerCase() !== (current.pairAddress || '').toLowerCase()
  )
    throw new Error('Reports must refer to the same network, token, and pool');
  const changes: Change[] = [];
  const add = (field: string, title: string, before: Json, after: Json, severity: Severity) => {
    if (before !== null && after !== null && JSON.stringify(before) !== JSON.stringify(after))
      changes.push({ field, title, before, after, severity });
  };
  add(
    'sellTax',
    'Observed sell tax changed',
    previous.metrics.sellTax,
    current.metrics.sellTax,
    'caution',
  );
  add(
    'buyTax',
    'Observed buy tax changed',
    previous.metrics.buyTax,
    current.metrics.buyTax,
    'caution',
  );
  add(
    'owner',
    'Detected owner changed',
    previous.contract.owner,
    current.contract.owner,
    'caution',
  );
  add(
    'implementation',
    'Proxy implementation changed',
    previous.contract.implementation,
    current.contract.implementation,
    'high',
  );
  if (previous.selectedPair?.address.toLowerCase() === current.selectedPair?.address.toLowerCase())
    add(
      'liquidity',
      'Pool liquidity changed',
      previous.selectedPair?.liquidityUsd ?? null,
      current.selectedPair?.liquidityUsd ?? null,
      'info',
    );
  else
    add(
      'selectedPool',
      'Automatically selected pool changed',
      previous.selectedPair?.address ?? null,
      current.selectedPair?.address ?? null,
      'info',
    );
  const old = new Map(previous.findings.map((f) => [f.id, f]));
  for (const f of current.findings)
    if (!old.has(f.id) && !['info', 'unknown'].includes(f.severity))
      changes.push({
        field: f.id,
        title: `New finding: ${f.title}`,
        before: null,
        after: f.title,
        severity: f.severity,
      });
  for (const s of current.sources) {
    const p = previous.sources.find((v) => v.source === s.source);
    if (p?.status === 'ok' && s.status !== 'ok')
      changes.push({
        field: `coverage:${s.source}`,
        title: `${SOURCE_LABELS[s.source]} coverage changed`,
        before: p.status,
        after: s.status,
        severity: 'unknown',
      });
  }
  return changes;
}
