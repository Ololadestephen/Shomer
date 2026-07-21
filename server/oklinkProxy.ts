/**
 * Server-side OKLink creation-info helper.
 * Used by the Vite dev/preview middleware only — API key never reaches the browser.
 */

export type OklinkChain = 'mainnet' | 'testnet';

export interface CreationInfoResult {
  ok: boolean;
  deployer?: string;
  txHash?: string | null;
  deployBlock?: number | null;
  source?: string;
  error?: 'missing_api_key' | 'invalid_address' | 'not_found' | 'upstream_error';
  message?: string;
  raw?: string;
}

const OKLINK_BASE = 'https://www.oklink.com/api/v5/explorer/contract/creation-info';

export function chainShortName(network: OklinkChain): string {
  return network === 'testnet' ? 'XLAYER_TESTNET' : 'XLAYER';
}

function extractCreator(data: Record<string, unknown>): {
  creator: string | null;
  txHash: string | null;
  deployBlock: number | null;
} {
  // OKLink may nest under data as object or single-element array
  let nested: Record<string, unknown> | undefined;
  const d = data.data;
  if (Array.isArray(d) && d.length > 0 && d[0] && typeof d[0] === 'object') {
    nested = d[0] as Record<string, unknown>;
  } else if (d && typeof d === 'object') {
    nested = d as Record<string, unknown>;
  }

  const creator =
    (nested?.creator as string) ||
    (nested?.contractCreator as string) ||
    (nested?.deployer as string) ||
    (data.contractCreator as string) ||
    (data.creator as string) ||
    null;

  const tx =
    (nested?.txHash as string) ||
    (nested?.creationTransactionHash as string) ||
    (nested?.txnHash as string) ||
    (data.txHash as string) ||
    null;

  const blockRaw =
    nested?.createContractBlock ||
    nested?.blockHeight ||
    nested?.blockNumber ||
    data.blockHeight;
  const deployBlock =
    blockRaw !== undefined && blockRaw !== null && blockRaw !== ''
      ? Number(blockRaw)
      : null;

  return {
    creator: creator && typeof creator === 'string' ? creator : null,
    txHash: tx && typeof tx === 'string' ? tx : null,
    deployBlock:
      deployBlock !== null && Number.isFinite(deployBlock) ? deployBlock : null,
  };
}

/**
 * Authenticated OKLink creation-info lookup.
 * @param apiKey server-only Ok-Access-Key
 */
export async function fetchCreationInfoAuthenticated(
  network: OklinkChain,
  contractAddress: string,
  apiKey: string,
): Promise<CreationInfoResult> {
  const addr = contractAddress.trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(addr)) {
    return {
      ok: false,
      error: 'invalid_address',
      message: 'Contract address must be a 0x-prefixed 40-hex address.',
    };
  }

  const chain = chainShortName(network);
  const url = `${OKLINK_BASE}?chainShortName=${encodeURIComponent(chain)}&contractAddress=${encodeURIComponent(addr)}`;

  try {
    const res = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        'Ok-Access-Key': apiKey,
      },
    });
    const text = await res.text();
    let data: Record<string, unknown> = {};
    try {
      data = JSON.parse(text) as Record<string, unknown>;
    } catch {
      return {
        ok: false,
        error: 'upstream_error',
        message: `OKLink returned non-JSON (HTTP ${res.status})`,
        raw: text.slice(0, 400),
      };
    }

    const rawSlice = text.slice(0, 600);
    if (!res.ok) {
      return {
        ok: false,
        error: 'upstream_error',
        message: `OKLink HTTP ${res.status}: ${String(data.msg ?? data.message ?? '')}`,
        raw: rawSlice,
      };
    }

    // OKLink business code: "0" = success
    if (data.code !== undefined && String(data.code) !== '0') {
      return {
        ok: false,
        error: 'not_found',
        message: String(data.msg ?? data.message ?? `OKLink code ${data.code}`),
        raw: rawSlice,
      };
    }

    const { creator, txHash, deployBlock } = extractCreator(data);
    if (!creator) {
      return {
        ok: false,
        error: 'not_found',
        message: 'OKLink response had no creator address.',
        raw: rawSlice,
      };
    }

    return {
      ok: true,
      deployer: creator,
      txHash: txHash && txHash.startsWith('0x') ? txHash : txHash,
      deployBlock,
      source: 'OKLink creation-info (authenticated via server proxy)',
      raw: rawSlice,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      error: 'upstream_error',
      message: msg,
    };
  }
}

/** Shared parse for public (unauthenticated) responses. */
export function parseCreationInfoBody(text: string): CreationInfoResult {
  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { ok: false, error: 'upstream_error', message: 'Non-JSON response' };
  }
  if (data.code !== undefined && String(data.code) !== '0') {
    return {
      ok: false,
      error: 'not_found',
      message: String(data.msg ?? data.message ?? `code ${data.code}`),
      raw: text.slice(0, 600),
    };
  }
  const { creator, txHash, deployBlock } = extractCreator(data);
  if (!creator) {
    return {
      ok: false,
      error: 'not_found',
      message: 'No creator in response',
      raw: text.slice(0, 600),
    };
  }
  return {
    ok: true,
    deployer: creator,
    txHash,
    deployBlock,
    source: 'OKLink creation-info (public)',
    raw: text.slice(0, 600),
  };
}

export { OKLINK_BASE };
