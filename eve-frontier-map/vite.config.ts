import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Polyfill for Node < 22 where crypto.hash is not available.
// Vite 7 uses crypto.hash internally (e.g., worker-import-meta-url plugin).
// We inject a small pre-build plugin that augments the cached node:crypto module.
function polyfillCryptoHash() {
  return {
    name: 'polyfill-crypto-hash',
    enforce: 'pre' as const,
    apply: 'build' as const,
    configResolved() {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const nodeCrypto = require('node:crypto');
        if (nodeCrypto && typeof nodeCrypto.hash !== 'function') {
          nodeCrypto.hash = (algorithm: string, data: string | Uint8Array, encoding: BufferEncoding = 'hex') => {
            const buf: any = typeof data === 'string' ? data : Buffer.from(data);
            return nodeCrypto.createHash(algorithm).update(buf).digest(encoding);
          };
        }
      } catch {
        // ignore – if this fails, the environment likely already supports crypto.hash
      }
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [polyfillCryptoHash(), react()],
})
