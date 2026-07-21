/**
 * Minimal x402 payment-required helpers for A2MCP paid endpoints.
 * Free endpoints do not use this module.
 *
 * Flow:
 * 1) No payment header → 402 + PAYMENT-REQUIRED (base64 PaymentRequired)
 * 2) Client pays and retries with PAYMENT-SIGNATURE / X-PAYMENT
 * 3) Optional facilitator verify when X402_FACILITATOR_URL is set
 *
 * Spec: https://www.x402.org / https://docs.x402.org
 */

export interface X402Config {
  /** Receiving wallet (EVM 0x…). Required for paid tier. */
  payTo: string;
  /** Human price like "$0.01" */
  priceUsd: string;
  /**
   * Settlement network for x402.
   * Default: X Layer mainnet CAIP-2 `eip155:196` (not Base).
   * Testnet: `eip155:1952` or set X402_NETWORK explicitly.
   */
  network: string;
  /** Asset symbol for description (typically USDC on X Layer) */
  asset: string;
  /** Optional facilitator base URL for settlement verification */
  facilitatorUrl?: string;
  /** Local/dev only: accept any non-empty payment header */
  devBypass?: boolean;
}

/** Normalize human labels → CAIP-2 style when possible. */
export function normalizeX402Network(raw: string | undefined): string {
  const n = (raw ?? '').trim().toLowerCase();
  if (!n || n === 'xlayer' || n === 'x-layer' || n === 'mainnet' || n === 'xlayer-mainnet') {
    return 'eip155:196';
  }
  if (n === 'xlayer-testnet' || n === 'testnet' || n === 'xlayer_testnet') {
    return 'eip155:1952';
  }
  if (n === 'base') return 'eip155:8453'; // only if explicitly forced
  if (n === 'base-sepolia') return 'eip155:84532';
  return raw!.trim(); // already eip155:… or custom
}

export function loadX402Config(): X402Config | null {
  const payTo = process.env.X402_PAY_TO?.trim() || process.env.X402_WALLET_ADDRESS?.trim();
  if (!payTo) return null;
  return {
    payTo,
    priceUsd: process.env.X402_PRICE_USD?.trim() || '$0.01',
    network: normalizeX402Network(process.env.X402_NETWORK),
    asset: process.env.X402_ASSET?.trim() || 'USDC',
    facilitatorUrl: process.env.X402_FACILITATOR_URL?.trim() || undefined,
    devBypass: process.env.X402_DEV_BYPASS === '1' || process.env.X402_DEV_BYPASS === 'true',
  };
}

/** Build PaymentRequired object (x402-compatible shape). */
export function buildPaymentRequired(
  cfg: X402Config,
  resource: string,
  description: string,
): Record<string, unknown> {
  // Amount: parse "$0.01" → atomic USDC (6 decimals) as string when possible
  const dollars = Number(String(cfg.priceUsd).replace(/[^0-9.]/g, '')) || 0.01;
  const atomic = String(Math.round(dollars * 1e6));

  return {
    x402Version: 1,
    error: 'Payment required to access Shomer paid verify',
    accepts: [
      {
        scheme: 'exact',
        network: cfg.network,
        maxAmountRequired: atomic,
        resource,
        description,
        mimeType: 'application/json',
        payTo: cfg.payTo,
        maxTimeoutSeconds: 60,
        asset: cfg.asset,
        extra: {
          name: 'Shomer paid verify',
          price: cfg.priceUsd,
          chain: 'X Layer',
          chainId: cfg.network === 'eip155:1952' ? 1952 : 196,
        },
      },
    ],
  };
}

export function encodePaymentRequired(obj: Record<string, unknown>): string {
  const s = JSON.stringify(obj);
  // Workers: prefer Buffer when nodejs_compat is on; else btoa
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const B = (globalThis as any).Buffer;
    if (B?.from) return B.from(s, 'utf8').toString('base64');
  } catch {
    /* fall through */
  }
  return btoa(unescape(encodeURIComponent(s)));
}

export function getPaymentHeader(headers: Record<string, string | string[] | undefined>): string | null {
  const pick = (k: string) => {
    const v = headers[k] ?? headers[k.toLowerCase()];
    if (Array.isArray(v)) return v[0] ?? null;
    return v ?? null;
  };
  // Common client headers across x402 SDK versions
  return (
    pick('payment-signature') ||
    pick('PAYMENT-SIGNATURE') ||
    pick('x-payment') ||
    pick('X-PAYMENT') ||
    pick('x-payment-response') ||
    null
  );
}

/**
 * Verify payment payload.
 * - devBypass: non-empty header accepted (local only)
 * - facilitator: POST { paymentHeader, paymentRequirements } when configured
 * - else: structural check only (document as incomplete settlement)
 */
export async function verifyPayment(
  cfg: X402Config,
  paymentHeader: string,
  paymentRequirements: Record<string, unknown>,
): Promise<{ ok: boolean; mode: string; detail?: string }> {
  if (!paymentHeader.trim()) {
    return { ok: false, mode: 'none', detail: 'Empty payment header' };
  }

  if (cfg.devBypass) {
    return {
      ok: true,
      mode: 'dev_bypass',
      detail: 'X402_DEV_BYPASS enabled — not for production settlement',
    };
  }

  if (cfg.facilitatorUrl) {
    try {
      const url = `${cfg.facilitatorUrl.replace(/\/$/, '')}/verify`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          x402Version: 1,
          paymentHeader,
          paymentPayload: paymentHeader,
          paymentRequirements,
        }),
      });
      const text = await res.text();
      let data: Record<string, unknown> = {};
      try {
        data = JSON.parse(text) as Record<string, unknown>;
      } catch {
        /* raw */
      }
      if (res.ok && (data.isValid === true || data.valid === true || data.success === true)) {
        return { ok: true, mode: 'facilitator', detail: text.slice(0, 300) };
      }
      // Some facilitators settle + return 200 with different shape
      if (res.ok && !data.error) {
        return { ok: true, mode: 'facilitator_ok', detail: text.slice(0, 300) };
      }
      return {
        ok: false,
        mode: 'facilitator',
        detail: data.error ? String(data.error) : `HTTP ${res.status}: ${text.slice(0, 200)}`,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, mode: 'facilitator', detail: msg };
    }
  }

  // Structural accept: payload present and decodable (agents can still complete free path)
  try {
    // May be base64 JSON or raw JSON
    let raw = paymentHeader;
    try {
      raw = Buffer.from(paymentHeader, 'base64').toString('utf8');
    } catch {
      /* keep */
    }
    if (raw.length < 8) {
      return { ok: false, mode: 'structural', detail: 'Payment payload too short' };
    }
    return {
      ok: true,
      mode: 'structural',
      detail:
        'Accepted non-empty payment header without facilitator. Set X402_FACILITATOR_URL for real settlement verification.',
    };
  } catch {
    return { ok: false, mode: 'structural', detail: 'Invalid payment header' };
  }
}
