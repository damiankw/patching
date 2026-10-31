import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react()],
  build: {
    outDir: fileURLToPath(new URL('../../dist/web', import.meta.url)),
    emptyOutDir: true,
  },
  server: {
    host: true,
    allowedHosts: true, // internal tool: accept any hostname (stable.example.net, LAN IPs, Tailscale names)
    port: 5173,
    proxy: { '/api': 'http://localhost:3000' },
  },
});
