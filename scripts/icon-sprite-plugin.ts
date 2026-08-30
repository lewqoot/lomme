import { readFileSync } from 'node:fs'
import { createRequire, register } from 'node:module'
import { pathToFileURL } from 'node:url'
import type { Plugin } from 'vite'
import { CORE_ICON_IDS, ICON_IDS } from '../src/config/icons.ts'

const require = createRequire(import.meta.url)

type IconNode = ReadonlyArray<[string, Record<string, string | number>]>

/**
 * Turns the icon manifest into one SVG sprite and inlines it into the document.
 *
 * Shapes are imported straight from lucide-react's own modules, so the app ships
 * only the icons it lists - not 2000 React components. Inlining keeps it to zero
 * extra requests, which matters on a cold Mini App start over mobile data.
 */
export function iconSprite(): Plugin {
  let cached: Promise<{ inline: string; library: string }> | undefined

  const build = async () => {
    const iconsDir = require.resolve('lucide-react').replace(/dist[/\\].*$/, 'dist/esm/icons/')

    // A few lucide names are aliases that only re-export `default`, so resolve the
    // chain to the module that actually declares the icon geometry.
    const resolve = (id: string, depth = 0): string => {
      if (depth > 4) throw new Error(`icon-sprite: alias loop on lucide icon "${id}"`)
      const file = `${iconsDir}${id}.mjs`
      const alias = readFileSync(file, 'utf8').match(/export \{ default \} from '\.\/([\w-]+)\.mjs'/)
      return alias ? resolve(alias[1], depth + 1) : file
    }

    const symbols = await Promise.all(ICON_IDS.map(async (id) => {
      const module = await import(pathToFileURL(resolve(id)).href) as { __iconNode?: IconNode }
      const node = module.__iconNode
      if (!node) throw new Error(`icon-sprite: lucide icon "${id}" exposes no geometry`)

      const body = node.map(([tag, attrs]) => {
        const pairs = Object.entries(attrs)
          .filter(([key]) => key !== 'key')
          .map(([key, value]) => `${key.replace(/([A-Z])/g, '-$1').toLowerCase()}="${value}"`)
          .join(' ')
        return `<${tag} ${pairs}/>`
      }).join('')

      // Stroke presentation must sit on the symbol itself: a <use> clone inherits from
      // where it is used, not from the sprite root it was defined under.
      return `<symbol id="i-${id}" viewBox="0 0 24 24" fill="none" stroke="currentColor"`
        + ` stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</symbol>`
    }))

    const wrap = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" aria-hidden="true"`
      + ` style="position:absolute;width:0;height:0;overflow:hidden">${body}</svg>`

    // Only the handful a wallet shows at rest goes into the document; the rest is a
    // separate file the app fetches the first time it needs an icon outside that set.
    const core = new Set<string>(CORE_ICON_IDS)
    const inline = symbols.filter((_, index) => core.has(ICON_IDS[index]))
    const rest = symbols.filter((_, index) => !core.has(ICON_IDS[index]))
    return { inline: wrap(inline.join('')), library: wrap(rest.join('')) }
  }

  return {
    name: 'lomme-icon-sprite',
    async generateBundle() {
      cached ??= build()
      this.emitFile({ type: 'asset', fileName: 'icons-library.svg', source: (await cached).library })
    },
    configureServer(server) {
      // Dev serves the same file from memory so the fetch path is exercised locally.
      server.middlewares.use('/icons-library.svg', async (_request, response) => {
        cached ??= build()
        response.setHeader('content-type', 'image/svg+xml')
        response.end((await cached).library)
      })
    },
    transformIndexHtml: {
      order: 'post',
      async handler(html) {
        cached ??= build()
        // The sprite must land before #root so the inline launch screen can use it.
        return html.replace('<div id="root">', `${(await cached).inline}<div id="root">`)
      },
    },
    handleHotUpdate(context) {
      if (context.file.endsWith('src/config/icons.ts') || context.file.endsWith('src/config/generated-icon-library.ts')) cached = undefined
    },
  }
}
