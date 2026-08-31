/** Stable, human-readable chunk names for build reports. */
export function manualChunks(id: string) {
  if (id.includes('/node_modules/recharts/')) return 'recharts'
  if (id.includes('@tanstack/react-query')) return 'query'
  if (id.includes('/react/') || id.includes('/react-dom/')) return 'vendor'
  return undefined
}
