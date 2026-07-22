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
  /** Settlement token contract address. */
  asset: string;
  /** EIP-712 token domain name. */
  assetName?: string;
  /** EIP-712 token domain version. */
  assetVersion?: string;
  /** Optional facilitator base URL for settlement verification */
  facilitatorUrl?: string;
  /** OKX Payment API credentials when using the official facilitator. */
  okxApiKey?: string;
  okxSecretKey?: string;
  okxPassphrase?: string;
  /** Local/dev only: accept any non-empty payment header */
  devBypass?: boolean;
}

export const XLAYER_USDC =
  '0x74b7f16337b8972027f6196a17a631ac6de26d22';

export interface VerifyPaymentOptions {
  /** Injectable for deterministic tests. Defaults to global fetch. */
  fetch?: typeof fetch;
  /** Facilitator response deadline. */
  timeoutMs?: number;
  /** Verify first, fulfill the resource, then settle only on success. */
  phase?: 'verify' | 'settle' | 'verify_and_settle';
}

const MAX_FACILITATOR_RESPONSE_BYTES = 64 * 1024;

async function readBoundedText(
  response: Response,
  maxBytes = MAX_FACILITATOR_RESPONSE_BYTES,
): Promise<string> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new Error('Facilitator response exceeded the 64 KiB limit');
  }
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel('response too large');
      throw new Error('Facilitator response exceeded the 64 KiB limit');
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
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
    asset: process.env.X402_ASSET?.trim() || XLAYER_USDC,
    assetName: process.env.X402_ASSET_NAME?.trim() || 'USD Coin',
    assetVersion: process.env.X402_ASSET_VERSION?.trim() || '2',
    facilitatorUrl: process.env.X402_FACILITATOR_URL?.trim() || undefined,
    okxApiKey: process.env.OKX_API_KEY?.trim() || undefined,
    okxSecretKey: process.env.OKX_SECRET_KEY?.trim() || undefined,
    okxPassphrase: process.env.OKX_PASSPHRASE?.trim() || undefined,
    devBypass: process.env.X402_DEV_BYPASS === '1' || process.env.X402_DEV_BYPASS === 'true',
  };
}

/** Build the OKX.AI A2MCP v2 PaymentRequired shape. */
export function buildPaymentRequired(
  cfg: X402Config,
  resource: string,
  description: string,
): Record<string, unknown> {
  // Amount: parse "$0.01" → atomic USDC (6 decimals) as string when possible
  const dollars = Number(String(cfg.priceUsd).replace(/[^0-9.]/g, '')) || 0.01;
  const atomic = String(Math.round(dollars * 1e6));

  return {
    x402Version: 2,
    error: 'Payment required to access Shomer paid verify',
    resource: {
      url: resource,
      description,
      mimeType: 'application/json',
    },
    accepts: [
      {
        scheme: 'exact',
        network: cfg.network,
        amount: atomic,
        payTo: cfg.payTo,
        maxTimeoutSeconds: 300,
        asset: cfg.asset,
        extra: {
          name: cfg.assetName ?? 'USD Coin',
          version: cfg.assetVersion ?? '2',
        },
      },
    ],
    // A2MCP clients use this metadata to preserve the original POST body when
    // replaying the request with PAYMENT-SIGNATURE. Without it, some clients
    // can replay an empty body after payment.
    outputSchema: {
      input: {
        type: 'http',
        method: 'POST',
        bodyType: 'json',
        body: {
          type: 'object',
          properties: {
            network: {
              type: 'string',
              enum: ['mainnet', 'testnet'],
              description: 'X Layer network containing the deployment.',
            },
            contractAddress: {
              type: 'string',
              pattern: '^0x[a-fA-F0-9]{40}$',
              description: 'Deployed EVM contract address to verify.',
            },
            projectName: { type: 'string' },
            policy: { type: 'object' },
            policyPreset: { type: 'string' },
            blockNumber: {
              oneOf: [{ type: 'integer' }, { type: 'string' }],
            },
            options: { type: 'object' },
            reviewedArtifact: { type: 'object' },
            deploymentArtifact: { type: 'object' },
            relatedContracts: {
              type: 'array',
              maxItems: 8,
            },
          },
          required: ['contractAddress'],
        },
      },
    },
  };
}

function decodePaymentPayload(paymentHeader: string): Record<string, unknown> | null {
  const candidates = [paymentHeader];
  try {
    candidates.unshift(Buffer.from(paymentHeader, 'base64').toString('utf8'));
  } catch {
    /* raw JSON may still be accepted below */
  }
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      /* try next representation */
    }
  }
  return null;
}

function bytesToBase64(bytes: Uint8Array): string {
  try {
    return Buffer.from(bytes).toString('base64');
  } catch {
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  }
}

function facilitatorData(data: Record<string, unknown>): Record<string, unknown> {
  const nested = data.data;
  return nested && typeof nested === 'object' && !Array.isArray(nested)
    ? nested as Record<string, unknown>
    : data;
}

async function facilitatorHeaders(
  cfg: X402Config,
  url: string,
  body: string,
): Promise<Record<string, string>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const target = new URL(url);
  const officialOkx = target.hostname === 'web3.okx.com';
  const credentials = [cfg.okxApiKey, cfg.okxSecretKey, cfg.okxPassphrase];
  const hasAnyCredential = credentials.some(Boolean);
  const hasAllCredentials = credentials.every(Boolean);
  if ((officialOkx || hasAnyCredential) && !hasAllCredentials) {
    throw new Error(
      'Official OKX facilitator requires OKX_API_KEY, OKX_SECRET_KEY, and OKX_PASSPHRASE.',
    );
  }
  if (!hasAllCredentials) return headers;

  const timestamp = new Date().toISOString();
  const requestPath = `${target.pathname}${target.search}`;
  const prehash = `${timestamp}POST${requestPath}${body}`;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(cfg.okxSecretKey!),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(prehash),
  );
  return {
    ...headers,
    'OK-ACCESS-KEY': cfg.okxApiKey!,
    'OK-ACCESS-SIGN': bytesToBase64(new Uint8Array(signature)),
    'OK-ACCESS-PASSPHRASE': cfg.okxPassphrase!,
    'OK-ACCESS-TIMESTAMP': timestamp,
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
 * - facilitator: verify then settle when configured
 * - else: fail closed
 */
export async function verifyPayment(
  cfg: X402Config,
  paymentHeader: string,
  paymentRequirements: Record<string, unknown>,
  options?: VerifyPaymentOptions,
): Promise<{
  ok: boolean;
  mode: string;
  detail?: string;
  responseHeader?: string;
}> {
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
    const paymentPayload = decodePaymentPayload(paymentHeader);
    const accepts = paymentRequirements.accepts;
    const selectedRequirement = Array.isArray(accepts) ? accepts[0] : null;
    if (!paymentPayload || !selectedRequirement) {
      return {
        ok: false,
        mode: 'invalid_payment_payload',
        detail: 'Payment authorization header is not decodable.',
      };
    }
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort('facilitator timeout'),
      options?.timeoutMs ?? 10_000,
    );
    try {
      const phase = options?.phase ?? 'verify_and_settle';
      const base = cfg.facilitatorUrl.replace(/\/$/, '');
      const fetchImpl = options?.fetch ?? fetch;
      const payload = {
        x402Version: 2,
        paymentPayload,
        paymentRequirements: selectedRequirement,
      };
      const callFacilitator = async (path: 'verify' | 'settle') => {
        const url = `${base}/${path}`;
        const body = JSON.stringify(
          path === 'settle' ? { ...payload, syncSettle: true } : payload,
        );
        const headers = await facilitatorHeaders(cfg, url, body);
        const response = await fetchImpl(url, {
          method: 'POST',
          headers,
          signal: controller.signal,
          body,
        });
        const text = await readBoundedText(response);
        let data: Record<string, unknown> = {};
        try {
          data = JSON.parse(text) as Record<string, unknown>;
        } catch {
          /* explicit checks below reject non-JSON */
        }
        return { response, text, data };
      };

      if (phase !== 'settle') {
        const verification = await callFacilitator('verify');
        const { response: res, text } = verification;
        const data = facilitatorData(verification.data);
        if (!(res.ok && (data.isValid === true || data.valid === true || data.success === true))) {
          return {
            ok: false,
            mode: 'facilitator',
            detail: data.error ? String(data.error) : `HTTP ${res.status}: ${text.slice(0, 200)}`,
          };
        }
        if (phase === 'verify') {
          return {
            ok: true,
            mode: 'facilitator_verified',
            detail: text.slice(0, 300),
          };
        }
      }

      const settlement = await callFacilitator('settle');
      const settlementData = facilitatorData(settlement.data);
      if (settlement.response.ok && settlementData.success === true) {
        return {
          ok: true,
          mode: 'facilitator_settled',
          detail: settlement.text.slice(0, 300),
          responseHeader: encodePaymentRequired(settlementData),
        };
      }
      return {
        ok: false,
        mode: 'facilitator_settle',
        detail: settlementData.errorMessage || settlementData.errorReason || settlementData.error
          ? String(settlementData.errorMessage ?? settlementData.errorReason ?? settlementData.error)
          : `HTTP ${settlement.response.status}: settlement was not explicitly confirmed`,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, mode: 'facilitator', detail: msg };
    } finally {
      clearTimeout(timeout);
    }
  }

  // Production must fail closed. A payment-looking string is not evidence of
  // authorization or settlement.
  return {
    ok: false,
    mode: 'facilitator_required',
    detail:
      'Payment verification is not configured. Set X402_FACILITATOR_URL or use the free endpoint.',
  };
}
