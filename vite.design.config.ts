import { cpSync, renameSync, writeFileSync } from 'node:fs'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { iconSprite } from './scripts/icon-sprite-plugin.ts'

// Builds the mock-driven design preview into a self-contained folder that can be
// deployed on its own - no database, no API, nothing from the main server.
export default defineConfig({
  plugins: [
    react(),
    iconSprite(),
    {
      name: 'design-preview-bundle',
      closeBundle() {
        renameSync('dist-design/design-preview.html', 'dist-design/index.html')
        cpSync('scripts/serve-design.mjs', 'dist-design/server.mjs')
        writeFileSync('dist-design/package.json', `${JSON.stringify({
          name: 'lomme-design-preview',
          private: true,
          type: 'module',
          scripts: { start: 'node server.mjs' },
        }, null, 2)}\n`)
      },
    },
  ],
  build: {
    // Both properties of prefixed features must survive minification: Chrome only
    // understands `backdrop-filter`, iOS Safari needs `-webkit-backdrop-filter`.
    cssTarget: ['chrome111', 'safari15.4', 'firefox121'],
    outDir: 'dist-design',
    emptyOutDir: true,
    rollupOptions: { input: 'design-preview.html' },
  },
})
