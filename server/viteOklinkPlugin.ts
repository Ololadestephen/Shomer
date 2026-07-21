/**
 * Vite plugin: mounts GET /api/oklink/creation-info on dev + preview servers.
 * Reads OKLINK_API_KEY from process.env (never bundled into client).
 */
import type { Plugin, Connect } from 'vite';
import {
  fetchCreationInfoAuthenticated,
  type OklinkChain,
  type CreationInfoResult,
} from './oklinkProxy';

function json(res: Connect.ServerResponse, status: number, body: CreationInfoResult) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function mountOklinkProxy(middlewares: Connect.Server) {
  middlewares.use((req, res, next) => {
    const url = req.url ?? '';
    if (!url.startsWith('/api/oklink/creation-info')) {
      next();
      return;
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      json(res, 405, {
        ok: false,
        error: 'upstream_error',
        message: 'Method not allowed',
      });
      return;
    }

    void (async () => {
      try {
        const parsed = new URL(url, 'http://localhost');
        const contractAddress = parsed.searchParams.get('contractAddress') ?? '';
        const networkParam = (parsed.searchParams.get('network') ?? 'mainnet').toLowerCase();
        const network: OklinkChain =
          networkParam === 'testnet' ? 'testnet' : 'mainnet';

        const apiKey = process.env.OKLINK_API_KEY?.trim();
        if (!apiKey) {
          json(res, 503, {
            ok: false,
            error: 'missing_api_key',
            message:
              'OKLINK_API_KEY is not set on the server. Add it to .env for authenticated deployer lookup. The client never receives this key.',
          });
          return;
        }

        const result = await fetchCreationInfoAuthenticated(
          network,
          contractAddress,
          apiKey,
        );
        const status = result.ok
          ? 200
          : result.error === 'invalid_address'
            ? 400
            : result.error === 'not_found'
              ? 404
              : 502;
        json(res, status, result);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        json(res, 500, {
          ok: false,
          error: 'upstream_error',
          message: msg,
        });
      }
    })();
  });
}

export function oklinkProxyPlugin(): Plugin {
  return {
    name: 'shomer-oklink-proxy',
    configureServer(server) {
      mountOklinkProxy(server.middlewares);
    },
    configurePreviewServer(server) {
      mountOklinkProxy(server.middlewares);
    },
  };
}
