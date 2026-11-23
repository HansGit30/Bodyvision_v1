import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const mp = JSON.parse(readFileSync(new URL('./node_modules/@mediapipe/tasks-vision/package.json', import.meta.url), 'utf8'))

export default defineConfig({
  plugins: [react()],
  define: { __MP_VERSION__: JSON.stringify(mp.version) },
  server: {
    port: 5173,
    proxy: { '/api': { target: process.env.VITE_PROXY_TARGET || 'http://localhost:8000', changeOrigin: true } },
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/three') || id.includes('@react-three') || id.includes('three-mesh-bvh')) return 'three'
          if (id.includes('recharts') || id.includes('d3-')) return 'charts'
          if (id.includes('@mediapipe')) return 'mediapipe'
          if (id.includes('node_modules/react') || id.includes('react-router') || id.includes('scheduler')) return 'react'
        },
      },
    },
  },
})
