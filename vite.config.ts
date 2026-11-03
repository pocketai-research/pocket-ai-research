import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// Cross-origin isolation lets wllama use several CPU threads (SharedArrayBuffer).
// The Android app adds the same headers in MainActivity; on GitHub Pages the service worker
// (src/sw.js) adds them.
const crossOriginIsolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
}

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

export default defineConfig({
  // The app's version, for the start page badge and the update check (src/updates.ts).
  define: { __APP_VERSION__: JSON.stringify(version) },
  // Relative base so the same build works on github.io/<repo>/ and on a custom domain.
  base: './',
  plugins: [
    react(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.js',
      // Registered by hand in src/main.tsx, and only on the web (not in the Android app).
      injectRegister: false,
      injectManifest: {
        globPatterns: ['**/*.{js,mjs,css,html,wasm,svg,png,ico,json,webmanifest}'],
        // The AI engine's WebAssembly is about 9 MB.
        maximumFileSizeToCacheInBytes: 20 * 1024 * 1024,
      },
      manifest: {
        name: 'Pocket Ai Research',
        short_name: 'Pocket Ai',
        description: 'Offline AI that runs on your device.',
        start_url: './',
        scope: './',
        display: 'standalone',
        theme_color: '#0f766e',
        background_color: '#0b1211',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  server: { headers: crossOriginIsolation },
  preview: { headers: crossOriginIsolation },
})
