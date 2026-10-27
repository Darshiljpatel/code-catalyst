import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import vercel from './vercel.json';

// Serve the production response headers from vercel.json in `vite preview`, so browser tests run under the same CSP.
// HSTS and the HTTPS upgrade are dropped because the preview is plain http://localhost.
const previewHeaders = Object.fromEntries(vercel.headers[0].headers
  .filter(header => header.key !== 'Strict-Transport-Security')
  .map(header => [header.key, header.value.replace('; upgrade-insecure-requests', '')]));

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Proxy /api/v1/* to the FastAPI backend in local dev.
      // This keeps the frontend same-origin relative to the API,
      // so session cookies and CSRF work correctly.
      '/api': {
        target: loadEnv(mode, '.', 'BRANDGUARD_').BRANDGUARD_API_TARGET || 'http://localhost:8000',
        changeOrigin: false, // preserve Host so CSRF origin check passes
      },
    },
  },
  preview: { headers: previewHeaders },
  build: {
    // Tree-shake dead code in production (ensures mock transport is excluded)
    minify: true,
    sourcemap: false,
  },
}));
