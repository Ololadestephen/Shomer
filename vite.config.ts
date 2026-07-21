import { defineConfig, loadEnv } from 'vite';
import { resolve } from 'path';
import { oklinkProxyPlugin } from './server/viteOklinkPlugin';
import { agentApiPlugin } from './server/viteAgentApiPlugin';

export default defineConfig(({ mode }) => {
  // Load .env into process.env for server-only plugins (never VITE_*)
  const env = loadEnv(mode, process.cwd(), '');
  const keys = [
    'OKLINK_API_KEY',
    'X402_PAY_TO',
    'X402_WALLET_ADDRESS',
    'X402_PRICE_USD',
    'X402_NETWORK',
    'X402_ASSET',
    'X402_ASSET_NAME',
    'X402_ASSET_VERSION',
    'X402_FACILITATOR_URL',
    'X402_DEV_BYPASS',
    'OKX_API_KEY',
    'OKX_SECRET_KEY',
    'OKX_PASSPHRASE',
  ] as const;
  for (const k of keys) {
    if (env[k] && !process.env[k]) process.env[k] = env[k];
  }

  return {
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src'),
      },
    },
    server: {
      port: 4173,
    },
    preview: {
      port: 4173,
    },
    plugins: [oklinkProxyPlugin(), agentApiPlugin()],
  };
});
