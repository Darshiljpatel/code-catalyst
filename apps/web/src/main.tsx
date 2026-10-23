/**
 * main.tsx — application entry point.
 *
 * Mock transport guard:
 *   Enabled ONLY in dev mode AND when VITE_USE_MOCK_API=true.
 *   This check happens at runtime before any API call is made.
 *   The production bundle tree-shakes the mock import entirely
 *   because import.meta.env.DEV resolves to `false` at build time.
 */
import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import './components.css';
import './studio.css';
import { App } from './App';
import { setTransport } from './api/client';

async function bootstrap() {
  // Dev-only mock transport — never ships in production build
  if (import.meta.env.DEV && import.meta.env.VITE_USE_MOCK_API === 'true') {
    const { mockTransport } = await import('./api/mockTransport');
    setTransport(mockTransport);
    console.info('[dev] Mock API transport enabled. Set VITE_USE_MOCK_API=false to use real backend.');
  }

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}

bootstrap();
