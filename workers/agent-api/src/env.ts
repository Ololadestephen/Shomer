export interface WorkerEnv {
  OKLINK_API_KEY?: string;
  X402_PAY_TO?: string;
  X402_WALLET_ADDRESS?: string;
  X402_PRICE_USD?: string;
  X402_NETWORK?: string;
  X402_ASSET?: string;
  X402_ASSET_NAME?: string;
  X402_ASSET_VERSION?: string;
  X402_FACILITATOR_URL?: string;
  X402_DEV_BYPASS?: string;
  OKX_API_KEY?: string;
  OKX_SECRET_KEY?: string;
  OKX_PASSPHRASE?: string;
  SERVICE_NAME?: string;
}

/** Inject Worker secrets/vars into process.env so shared server modules can read them. */
export function injectProcessEnv(env: WorkerEnv): void {
  const g = globalThis as {
    process?: { env?: Record<string, string | undefined> };
  };
  if (!g.process) g.process = { env: {} };
  if (!g.process.env) g.process.env = {};
  const e = g.process.env;
  // Copy all string bindings (vars + secrets)
  for (const [k, v] of Object.entries(env as Record<string, unknown>)) {
    if (typeof v === 'string' && v.length > 0) e[k] = v;
  }
}
