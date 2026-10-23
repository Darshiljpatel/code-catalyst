import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Proxy /api/v1/* to the FastAPI backend in local dev.
      // This keeps the frontend same-origin relative to the API,
      // so session cookies and CSRF work correctly.
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: false, // preserve Host so CSRF origin check passes
      },
    },
  },
  build: {
    // Tree-shake dead code in production (ensures mock transport is excluded)
    minify: true,
    sourcemap: false,
  },
});
