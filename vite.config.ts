import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { iconSprite } from './scripts/icon-sprite-plugin.ts'
import { manualChunks } from './scripts/manual-chunks.ts'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), iconSprite()],
  server: {
    host: '127.0.0.1',
    port: 4173,
    proxy: { '/api': 'http://127.0.0.1:3000', '/healthz': 'http://127.0.0.1:3000' },
  },
  build: {
    // Both properties of prefixed features must survive minification: Chrome only
    // understands `backdrop-filter`, iOS Safari needs `-webkit-backdrop-filter`.
    cssTarget: ['chrome111', 'safari15.4', 'firefox121'],
    rollupOptions: {
      // Recharts remains reachable only from the existing dynamic chart imports;
      // this merely gives its lazy chunk a useful name in build reports.
      output: { manualChunks },
    },
  },
})
