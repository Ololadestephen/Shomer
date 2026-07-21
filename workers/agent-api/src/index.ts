/**
 * Cloudflare Worker: Shomer A2MCP free + paid verify.
 * Public HTTPS, no laptop/tunnel required after deploy.
 *
 * Routes:
 *   GET  /              or /api/agent
 *   POST /api/agent/verify
 *   POST /api/agent/verify/paid
 *   GET  /api/agent/packs
 *   POST /api/agent/read
 *   POST /api/agent/draft
 */
import {
  agentServiceCatalog,
  runAgentVerify,
  type AgentVerifyRequest,
} from '../../../server/agentVerify';
import {
  listPacksResponse,
  runAgentCreateDraft,
  runAgentRead,
} from '../../../server/agentTools';
import { runAgentShipGate } from '../../../server/agentShipGate';
import {
  buildPaymentRequired,
  encodePaymentRequired,
  getPaymentHeader,
  loadX402Config,
  verifyPayment,
} from '../../../server/x402';
import { injectProcessEnv, type WorkerEnv } from './env';
import {
  HttpRequestError,
  readJsonRequest,
} from '../../../server/httpSafety';

const cors: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers':
    'Content-Type, PAYMENT-SIGNATURE, X-PAYMENT, Payment-Signature, Payment-Required',
  'Cache-Control': 'no-store',
};

function json(
  status: number,
  body: unknown,
  extra?: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...cors,
      ...extra,
    },
  });
}

function pathOf(url: URL): string {
  return url.pathname.replace(/\/$/, '') || '/';
}

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    injectProcessEnv(env);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    const url = new URL(request.url);
    const path = pathOf(url);
    const base = url.origin;

    try {
      // Catalog
      if (
        request.method === 'GET' &&
        (path === '/' || path === '/api/agent')
      ) {
        return json(200, agentServiceCatalog(base));
      }

      // Free verify
      if (path === '/api/agent/verify') {
        if (request.method !== 'POST') {
          return json(405, { ok: false, error: 'method_not_allowed' });
        }
        const input = await readJsonRequest<AgentVerifyRequest>(request);
        const { status, body } = await runAgentVerify(input, 'free');
        return json(status, body);
      }

      // Paid verify (x402) — settlement network defaults to X Layer
      if (path === '/api/agent/verify/paid') {
        if (request.method !== 'POST') {
          return json(405, { ok: false, error: 'method_not_allowed' });
        }

        try {
          const cfg = loadX402Config();
          if (!cfg) {
            return json(503, {
              ok: false,
              error: 'paid_not_configured',
              message:
                'Set Worker secret X402_PAY_TO (receiving wallet on X Layer). Free: POST /api/agent/verify',
            });
          }

          const headerMap: Record<string, string | undefined> = {};
          request.headers.forEach((v, k) => {
            headerMap[k] = v;
            headerMap[k.toLowerCase()] = v;
          });
          const paymentHeader = getPaymentHeader(headerMap);
          const resource = `${base}/api/agent/verify/paid`;
          const requirements = buildPaymentRequired(
            cfg,
            resource,
            'Shomer paid X Layer deployment policy verification',
          );

          if (!paymentHeader) {
            const encoded = encodePaymentRequired(requirements);
            return json(
              402,
              {
                ok: false,
                error: 'payment_required',
                x402Version: 2,
                accepts: requirements.accepts,
                message:
                  'Payment required (x402 on X Layer). Retry with PAYMENT-SIGNATURE or X-PAYMENT.',
                freeAlternative: `${base}/api/agent/verify`,
              },
              {
                'PAYMENT-REQUIRED': encoded,
              },
            );
          }

          const paymentCheck = await verifyPayment(
            cfg,
            paymentHeader,
            requirements,
          );
          if (!paymentCheck.ok) {
            return json(402, {
              ok: false,
              error: 'payment_invalid',
              message: paymentCheck.detail ?? 'Payment verification failed',
              mode: paymentCheck.mode,
            });
          }

          const input = await readJsonRequest<AgentVerifyRequest>(request);

          const { status, body } = await runAgentVerify(input, 'paid');
          return json(
            status,
            {
              ...body,
              payment: {
                settled: true,
                mode: paymentCheck.mode,
                detail: paymentCheck.detail,
                network: cfg.network,
              },
            },
            paymentCheck.responseHeader
              ? { 'PAYMENT-RESPONSE': paymentCheck.responseHeader }
              : undefined,
          );
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return json(500, {
            ok: false,
            error: 'paid_handler_error',
            message: msg,
          });
        }
      }

      // Policy packs catalog
      if (path === '/api/agent/packs') {
        if (request.method !== 'GET' && request.method !== 'HEAD') {
          return json(405, { ok: false, error: 'method_not_allowed' });
        }
        return json(200, listPacksResponse());
      }

      // Read facts only
      if (path === '/api/agent/read') {
        if (request.method !== 'POST') {
          return json(405, { ok: false, error: 'method_not_allowed' });
        }
        const input = await readJsonRequest<{
          network?: string;
          contractAddress: string;
          blockNumber?: number | string;
        }>(request);
        const { status, body } = await runAgentRead(input);
        return json(status, body);
      }

      // Free ship-gate
      if (path === '/api/agent/ship-gate') {
        if (request.method !== 'POST') {
          return json(405, { ok: false, error: 'method_not_allowed' });
        }
        const input = await readJsonRequest<Parameters<typeof runAgentShipGate>[0]>(request);
        const { status, body } = await runAgentShipGate(input);
        return json(status, body);
      }

      // Create draft from pack
      if (path === '/api/agent/draft') {
        if (request.method !== 'POST') {
          return json(405, { ok: false, error: 'method_not_allowed' });
        }
        const input = await readJsonRequest<Parameters<typeof runAgentCreateDraft>[0]>(request);
        const { status, body } = await runAgentCreateDraft(input);
        return json(status, body);
      }

      return json(404, {
        ok: false,
        error: 'not_found',
        message:
          'Use GET /api/agent, GET /api/agent/packs, POST /api/agent/read, POST /api/agent/draft, POST /api/agent/ship-gate, POST /api/agent/verify, or POST /api/agent/verify/paid',
      });
    } catch (err) {
      if (err instanceof HttpRequestError) {
        return json(err.status, {
          ok: false,
          error: err.code,
          message: err.message,
        });
      }
      const msg = err instanceof Error ? err.message : String(err);
      return json(500, { ok: false, error: 'server_error', message: msg });
    }
  },
};
