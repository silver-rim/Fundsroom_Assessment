import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Fail loudly instead of silently moving to 5174, which would then be
    // rejected by the backend's CORS allow-list and look like a broken API.
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
