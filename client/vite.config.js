import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev server proxies API + websocket to the Express server on :5000.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:5000',
      '/socket.io': { target: 'http://localhost:5000', ws: true },
    },
  },
});
