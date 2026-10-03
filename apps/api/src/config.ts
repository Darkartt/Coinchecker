import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
loadEnv({ path: fileURLToPath(new URL('../../../.env', import.meta.url)), quiet: true });
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  DATABASE_URL: z
    .string()
    .default('postgresql://coinchecker:coinchecker_local@localhost:55432/coinchecker'),
  REDIS_URL: z.string().default('redis://localhost:56379'),
  ALLOWED_ORIGINS: z.string().default('http://localhost:4173,http://127.0.0.1:4173'),
  EXTENSION_IDS: z.string().default(''),
  ETHERSCAN_API_KEY: z.string().default(''),
  COINGECKO_API_KEY: z.string().default(''),
  COINGECKO_API_TIER: z.enum(['demo', 'pro']).default('demo'),
  GOPLUS_ACCESS_TOKEN: z.string().default(''),
  HONEYPOT_API_KEY: z.string().default(''),
  HONEYPOT_PRODUCTION_PERMISSION: z.enum(['false', 'true']).default('false'),
  ETHEREUM_RPC_URL: z.string().url().default('https://ethereum-rpc.publicnode.com'),
  BASE_RPC_URL: z.string().url().default('https://mainnet.base.org'),
  PROVIDER_TIMEOUT_MS: z.coerce.number().min(1000).max(60000).default(12000),
  SCAN_CACHE_SECONDS: z.coerce.number().min(10).max(600).default(60),
  MONITOR_INTERVAL_SECONDS: z.coerce.number().min(10).max(3600).default(300),
  RPC_LOG_LOOKBACK: z.coerce.number().int().min(1).max(10000).default(500),
  RPC_LOG_CHUNK: z.coerce.number().int().min(1).max(2000).default(500),
});
export type Configuration = z.infer<typeof schema>;
export const settings = schema.parse(process.env);
if (settings.NODE_ENV === 'production' && !settings.EXTENSION_IDS.trim())
  throw new Error('Set EXTENSION_IDS to the installed extension IDs before production startup.');
