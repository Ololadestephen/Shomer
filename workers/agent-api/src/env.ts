/** Wrangler generates all declared vars and bindings in worker-configuration.d.ts. */
export type WorkerEnv = Env & {
  /** Secrets are dashboard-managed and therefore augmented here. */
  OKLINK_API_KEY?: string;
  X402_PAY_TO?: string;
  X402_WALLET_ADDRESS?: string;
  OKX_API_KEY?: string;
  OKX_SECRET_KEY?: string;
  OKX_PASSPHRASE?: string;
};

/** Inject Worker secrets/vars into process.env so shared server modules can read them. */
export function injectProcessEnv(env: WorkerEnv): void {
  const g = globalThis as {
    process?: { env?: Record<string, string | undefined> };
  };
  if (!g.process) g.process = { env: {} };
  if (!g.process.env) g.process.env = {};
  const e = g.process.env;
  // Copy all string bindings (vars + secrets)
  for (const [k, v] of Object.entries(env)) {
    if (typeof v === 'string' && v.length > 0) e[k] = v;
  }
}
