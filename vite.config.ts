import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { iconSprite } from './scripts/icon-sprite-plugin.ts'

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
      // Let Rollup keep Recharts behind its dynamic imports.  Assigning all of
      // its transitive modules to a manual chunk made the browser preload the
      // 119 KB gzip chart bundle before Home had rendered.
      output: { manualChunks: (id) => id.includes('lottie') ? 'lottie' : id.includes('@tanstack/react-query') ? 'query' : id.includes('/react/') || id.includes('/react-dom/') ? 'vendor' : undefined },
    },
  },
})
