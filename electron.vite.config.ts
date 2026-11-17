import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {
    resolve: { alias: { '@core': resolve('src/core'), '@shared': resolve('src/shared'), '@brand': resolve('brand') } }
  },
  preload: {
    resolve: { alias: { '@shared': resolve('src/shared') } }
  },
  renderer: {
    resolve: {
      alias: {
        '@': resolve('src/renderer/src'),
        '@shared': resolve('src/shared'),
        '@core': resolve('src/core'),
        '@brand': resolve('brand')
      }
    },
    plugins: [react(), tailwindcss()]
  }
})
