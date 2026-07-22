/**
 * Vite plugin: A2MCP agent APIs
 * - GET  /api/agent              — service catalog
 * - POST /api/agent/verify      — free tier (no payment)
 * - POST /api/agent/verify/paid — x402 paid tier
 * - GET  /api/agent/packs       — list policy packs
 * - POST /api/agent/read        — read deployment facts
 * - POST /api/agent/draft       — create draft from pack
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin, Connect } from 'vite';
import {
  agentServiceCatalog,
  runAgentVerify,
  type AgentVerifyRequest,
} from './agentVerify';
import {
  listPacksResponse,
  runAgentCreateDraft,
  runAgentRead,
} from './agentTools';
import { runAgentShipGate } from './agentShipGate';
import {
  buildPaymentRequired,
  encodePaymentRequired,
  getPaymentHeader,
  loadX402Config,
  verifyPayment,
} from './x402';
import {
  HttpRequestError,
  MAX_REQUEST_BODY_BYTES,
} from './httpSafety';

function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  extraHeaders?: Record<string, string>,
) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, PAYMENT-SIGNATURE, X-PAYMENT, Payment-Signature');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (extraHeaders) {
    for (const [k, v] of Object.entries(extraHeaders)) res.setHeader(k, v);
  }
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let tooLarge = false;
    req.on('data', (c: Buffer) => {
      size += c.byteLength;
      if (size > MAX_REQUEST_BODY_BYTES) {
        tooLarge = true;
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (tooLarge) {
        reject(
          new HttpRequestError(
            413,
            'payload_too_large',
            `JSON body exceeds ${MAX_REQUEST_BODY_BYTES} bytes.`,
          ),
        );
        return;
      }
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', reject);
  });
}

function pathOnly(url: string): string {
  return url.split('?')[0] ?? url;
}

function publicBase(req: IncomingMessage): string {
  const host = req.headers.host ?? 'localhost:4173';
  const proto = (req.headers['x-forwarded-proto'] as string) || 'http';
  return `${proto}://${host}`;
}

function mountAgentApi(middlewares: Connect.Server) {
  middlewares.use((req, res, next) => {
    const rawUrl = req.url ?? '';
    const path = pathOnly(rawUrl);

    if (!path.startsWith('/api/agent')) {
      next();
      return;
    }

    // CORS preflight
    if (req.method === 'OPTIONS') {
      sendJson(res, 204, {});
      return;
    }

    void (async () => {
      try {
        // Catalog
        if (path === '/api/agent' || path === '/api/agent/') {
          if (req.method !== 'GET' && req.method !== 'HEAD') {
            sendJson(res, 405, { ok: false, error: 'method_not_allowed' });
            return;
          }
          sendJson(res, 200, agentServiceCatalog(publicBase(req)));
          return;
        }

        // Free verify
        if (path === '/api/agent/verify') {
          if (req.method !== 'POST') {
            sendJson(res, 405, { ok: false, error: 'method_not_allowed', message: 'Use POST' });
            return;
          }
          const raw = await readBody(req);
          let input: AgentVerifyRequest;
          try {
            input = JSON.parse(raw || '{}') as AgentVerifyRequest;
          } catch {
            sendJson(res, 400, { ok: false, error: 'invalid_json' });
            return;
          }
          const { status, body } = await runAgentVerify(input, 'free');
          sendJson(res, status, body);
          return;
        }

        // Paid verify (x402)
        if (path === '/api/agent/verify/paid') {
          if (req.method !== 'POST') {
            sendJson(res, 405, { ok: false, error: 'method_not_allowed', message: 'Use POST' });
            return;
          }

          const cfg = loadX402Config();
          if (!cfg) {
            sendJson(res, 503, {
              ok: false,
              error: 'paid_not_configured',
              message:
                'Paid tier requires X402_PAY_TO (receiving wallet) in server env. Use free POST /api/agent/verify until configured.',
            });
            return;
          }

          // Validate and retain the business request before touching payment.
          // A malformed replay must never be verified or settled.
          const raw = await readBody(req);
          let input: AgentVerifyRequest;
          try {
            input = JSON.parse(raw || '{}') as AgentVerifyRequest;
          } catch {
            sendJson(res, 400, { ok: false, error: 'invalid_json' });
            return;
          }

          const headers = req.headers as Record<string, string | string[] | undefined>;
          const paymentHeader = getPaymentHeader(headers);
          const resource = `${publicBase(req)}/api/agent/verify/paid`;
          const requirements = buildPaymentRequired(
            cfg,
            resource,
            'Shomer paid X Layer deployment policy verification',
          );

          if (!paymentHeader) {
            const encoded = encodePaymentRequired(requirements);
            sendJson(
              res,
              402,
              {
                ok: false,
                error: 'payment_required',
                x402Version: 2,
                accepts: requirements.accepts,
                outputSchema: requirements.outputSchema,
                message:
                  'Payment required (x402). Retry with PAYMENT-SIGNATURE or X-PAYMENT header after paying.',
                freeAlternative: `${publicBase(req)}/api/agent/verify`,
              },
              {
                'PAYMENT-REQUIRED': encoded,
              },
            );
            return;
          }

          const paymentCheck = await verifyPayment(
            cfg,
            paymentHeader,
            requirements,
            { phase: 'verify' },
          );
          if (!paymentCheck.ok) {
            sendJson(res, 402, {
              ok: false,
              error: 'payment_invalid',
              message: paymentCheck.detail ?? 'Payment verification failed',
              mode: paymentCheck.mode,
            });
            return;
          }

          const { status, body } = await runAgentVerify(input, 'paid');
          if (status < 200 || status >= 300 || body.ok !== true) {
            sendJson(res, status, body);
            return;
          }

          const settlement = await verifyPayment(
            cfg,
            paymentHeader,
            requirements,
            { phase: 'settle' },
          );
          if (!settlement.ok) {
            sendJson(res, 402, {
              ok: false,
              error: 'payment_settlement_failed',
              message: settlement.detail ?? 'Payment settlement failed',
              mode: settlement.mode,
            });
            return;
          }
          sendJson(
            res,
            status,
            {
              ...body,
              payment: {
                settled: true,
                mode: settlement.mode,
                detail: settlement.detail,
              },
            },
            settlement.responseHeader
              ? { 'PAYMENT-RESPONSE': settlement.responseHeader }
              : undefined,
          );
          return;
        }

        // List policy packs
        if (path === '/api/agent/packs') {
          if (req.method !== 'GET' && req.method !== 'HEAD') {
            sendJson(res, 405, { ok: false, error: 'method_not_allowed' });
            return;
          }
          sendJson(res, 200, listPacksResponse());
          return;
        }

        // Read deployment state (facts only)
        if (path === '/api/agent/read') {
          if (req.method !== 'POST') {
            sendJson(res, 405, { ok: false, error: 'method_not_allowed', message: 'Use POST' });
            return;
          }
          const raw = await readBody(req);
          let input: { network?: string; contractAddress: string; blockNumber?: number | string };
          try {
            input = JSON.parse(raw || '{}');
          } catch {
            sendJson(res, 400, { ok: false, error: 'invalid_json' });
            return;
          }
          const { status, body } = await runAgentRead(input);
          sendJson(res, status, body);
          return;
        }

        // Free ship-gate composite
        if (path === '/api/agent/ship-gate') {
          if (req.method !== 'POST') {
            sendJson(res, 405, { ok: false, error: 'method_not_allowed', message: 'Use POST' });
            return;
          }
          const raw = await readBody(req);
          let input: Parameters<typeof runAgentShipGate>[0];
          try {
            input = JSON.parse(raw || '{}');
          } catch {
            sendJson(res, 400, { ok: false, error: 'invalid_json' });
            return;
          }
          const { status, body } = await runAgentShipGate(input);
          sendJson(res, status, body);
          return;
        }

        // Create policy draft from pack (never approved)
        if (path === '/api/agent/draft') {
          if (req.method !== 'POST') {
            sendJson(res, 405, { ok: false, error: 'method_not_allowed', message: 'Use POST' });
            return;
          }
          const raw = await readBody(req);
          let input: {
            packId: string;
            network?: string;
            contractAddress?: string;
            projectName?: string;
            fillFromLive?: boolean;
            overrides?: Record<string, unknown>;
            blockNumber?: number | string;
          };
          try {
            input = JSON.parse(raw || '{}');
          } catch {
            sendJson(res, 400, { ok: false, error: 'invalid_json' });
            return;
          }
          const { status, body } = await runAgentCreateDraft(input as Parameters<typeof runAgentCreateDraft>[0]);
          sendJson(res, status, body);
          return;
        }

        sendJson(res, 404, { ok: false, error: 'not_found', path });
      } catch (err) {
        if (err instanceof HttpRequestError) {
          sendJson(res, err.status, {
            ok: false,
            error: err.code,
            message: err.message,
          });
          return;
        }
        const msg = err instanceof Error ? err.message : String(err);
        sendJson(res, 500, { ok: false, error: 'server_error', message: msg });
      }
    })();
  });
}

export function agentApiPlugin(): Plugin {
  return {
    name: 'shomer-agent-api',
    configureServer(server) {
      mountAgentApi(server.middlewares);
    },
    configurePreviewServer(server) {
      mountAgentApi(server.middlewares);
    },
  };
}
