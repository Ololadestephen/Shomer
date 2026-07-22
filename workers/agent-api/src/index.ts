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
  normalizeAgentVerifyRequest,
  runAgentVerify,
  validateAgentVerifyRequest,
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
import {
  beginPaidReceipt,
  getPaidReceipt,
  paymentReceiptIdentity,
  savePaidReceiptError,
  savePaidReport,
  savePaidSettlement,
  type PaidReceiptRecord,
} from '../../../server/paymentReceipts';

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

function reportIdOf(body: Record<string, unknown>): string | null {
  const deep = body.deepVerification;
  if (!deep || typeof deep !== 'object' || Array.isArray(deep)) return null;
  const brief = (deep as Record<string, unknown>).auditorBrief;
  if (!brief || typeof brief !== 'object' || Array.isArray(brief)) return null;
  const reportId = (brief as Record<string, unknown>).reportId;
  return typeof reportId === 'string' ? reportId : null;
}

function recoveredBody(
  record: PaidReceiptRecord,
  base: string,
): Record<string, unknown> | null {
  if (!record.responseBody) return null;
  const existing = record.responseBody.payment;
  const payment = existing && typeof existing === 'object' && !Array.isArray(existing)
    ? existing as Record<string, unknown>
    : {};
  return {
    ...record.responseBody,
    payment: {
      ...payment,
      settled: true,
      recovered: true,
      receiptId: record.receiptId,
      transactionHash: record.transactionHash,
      retrievalUrl: `${base}/api/agent/receipts/${record.receiptId}`,
    },
  };
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

      // Bearer-capability recovery URL returned after a paid verification.
      if (request.method === 'GET' && path.startsWith('/api/agent/receipts/')) {
        const receiptId = path.slice('/api/agent/receipts/'.length);
        if (!/^shomer_[a-f0-9]{64}$/.test(receiptId)) {
          return json(400, { ok: false, error: 'invalid_receipt_id' });
        }
        const record = await getPaidReceipt(env.SHOMER_RECEIPTS, receiptId);
        if (!record) {
          return json(404, { ok: false, error: 'receipt_not_found' });
        }
        if (record.state !== 'settled') {
          return json(202, {
            ok: true,
            receiptId,
            state: record.state,
            message:
              'Payment or report finalization is still pending. Retry the paid POST with the same payment authorization.',
          });
        }
        const body = recoveredBody(record, base);
        if (!body) {
          return json(500, {
            ok: false,
            error: 'receipt_corrupt',
            receiptId,
          });
        }
        return json(
          record.responseStatus ?? 200,
          body,
          record.paymentResponseHeader
            ? { 'PAYMENT-RESPONSE': record.paymentResponseHeader }
            : undefined,
        );
      }

      // Free verify
      if (path === '/api/agent/verify') {
        if (request.method !== 'POST') {
          return json(405, { ok: false, error: 'method_not_allowed' });
        }
        const input = normalizeAgentVerifyRequest(
          await readJsonRequest<unknown>(request),
        );
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

          // Validate and retain the business request before touching payment.
          // A malformed replay must never be verified or settled.
          const input = normalizeAgentVerifyRequest(
            await readJsonRequest<unknown>(request),
          );
          if (validateAgentVerifyRequest(input, 'paid')) {
            const { status, body } = await runAgentVerify(input, 'paid');
            return json(status, body);
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
            'Shomer Deep Verify — privilege map, artifact match, Auditor Brief (X Layer)',
          );

          if (!paymentHeader) {
            const encoded = encodePaymentRequired(requirements);
            return json(
              402,
              {
                ok: false,
                error: 'payment_required',
                x402Version: 2,
                resource: requirements.resource,
                accepts: requirements.accepts,
                outputSchema: requirements.outputSchema,
                extensions: requirements.extensions,
                message:
                  'Payment required (x402 on X Layer). Retry with PAYMENT-SIGNATURE or X-PAYMENT.',
                freeAlternative: `${base}/api/agent/verify`,
              },
              {
                'PAYMENT-REQUIRED': encoded,
              },
            );
          }

          const identity = await paymentReceiptIdentity(paymentHeader, input);
          let persisted = await getPaidReceipt(
            env.SHOMER_RECEIPTS,
            identity.receiptId,
          );
          if (persisted && persisted.requestHash !== identity.requestHash) {
            return json(409, {
              ok: false,
              error: 'payment_replay_mismatch',
              message:
                'This payment authorization is already associated with a different request body.',
              receiptId: identity.receiptId,
            });
          }
          if (persisted?.state === 'settled') {
            const body = recoveredBody(persisted, base);
            if (!body) {
              return json(500, {
                ok: false,
                error: 'receipt_corrupt',
                receiptId: identity.receiptId,
              });
            }
            return json(
              persisted.responseStatus ?? 200,
              body,
              persisted.paymentResponseHeader
                ? { 'PAYMENT-RESPONSE': persisted.paymentResponseHeader }
                : undefined,
            );
          }

          let reportStatus = persisted?.responseStatus ?? null;
          let reportBody = persisted?.responseBody ?? null;

          if (persisted?.state !== 'report_ready' || !reportBody || !reportStatus) {
            const paymentCheck = await verifyPayment(
              cfg,
              paymentHeader,
              requirements,
              { phase: 'verify' },
            );
            if (!paymentCheck.ok) {
              return json(402, {
                ok: false,
                error: 'payment_invalid',
                message: paymentCheck.detail ?? 'Payment verification failed',
                mode: paymentCheck.mode,
              });
            }

            const { status, body } = await runAgentVerify(input, 'paid');
            if (status < 200 || status >= 300 || body.ok !== true) {
              return json(status, body);
            }
            persisted = await beginPaidReceipt(env.SHOMER_RECEIPTS, identity);
            if (persisted.requestHash !== identity.requestHash) {
              return json(409, {
                ok: false,
                error: 'payment_replay_mismatch',
                receiptId: identity.receiptId,
              });
            }
            reportStatus = status;
            reportBody = { ...body };
            await savePaidReport(env.SHOMER_RECEIPTS, {
              receiptId: identity.receiptId,
              responseStatus: status,
              responseBody: reportBody,
              reportId: reportIdOf(reportBody),
              network: body.network,
            });
          }

          const settlement = await verifyPayment(
            cfg,
            paymentHeader,
            requirements,
            { phase: 'settle' },
          );
          if (!settlement.ok) {
            await savePaidReceiptError(
              env.SHOMER_RECEIPTS,
              identity.receiptId,
              settlement.detail ?? 'Payment settlement failed',
            );
            return json(402, {
              ok: false,
              error: 'payment_settlement_failed',
              message: settlement.detail ?? 'Payment settlement failed',
              mode: settlement.mode,
              receiptId: identity.receiptId,
            });
          }
          const finalBody = {
            ...reportBody,
            payment: {
              settled: true,
              recovered: persisted?.state === 'report_ready',
              mode: settlement.mode,
              detail: settlement.detail,
              network: cfg.network,
              receiptId: identity.receiptId,
              transactionHash: settlement.transactionHash ?? null,
              retrievalUrl: `${base}/api/agent/receipts/${identity.receiptId}`,
            },
          };
          await savePaidSettlement(env.SHOMER_RECEIPTS, {
            receiptId: identity.receiptId,
            responseBody: finalBody,
            paymentResponseHeader: settlement.responseHeader ?? null,
            transactionHash: settlement.transactionHash ?? null,
          });
          return json(
            reportStatus,
            finalBody,
            settlement.responseHeader
              ? { 'PAYMENT-RESPONSE': settlement.responseHeader }
              : undefined,
          );
        } catch (err) {
          if (err instanceof HttpRequestError) throw err;
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
          'Use GET /api/agent, GET /api/agent/receipts/:id, GET /api/agent/packs, POST /api/agent/read, POST /api/agent/draft, POST /api/agent/ship-gate, POST /api/agent/verify, or POST /api/agent/verify/paid',
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
