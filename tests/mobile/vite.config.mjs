import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const path = relative => fileURLToPath(new URL(relative, import.meta.url));

// Test-only server: no fixture route or mock is included in the shipped app.
export default defineConfig({
  root: path('./fixture'),
  plugins: [react()],
  resolve: {
    alias: [
      { find: '@/hooks/use-webrtc', replacement: path('./fixture/session-transport.js') },
      { find: '@/hooks/use-recordings', replacement: path('./fixture/recordings.js') },
      { find: '@', replacement: path('../../client/src') },
      { find: '@shared', replacement: path('../../shared') },
    ],
  },
  css: { postcss: path('../../') },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    fs: { allow: [path('../../')] },
  },
});
