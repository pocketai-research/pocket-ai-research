import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Cross-origin isolation lets wllama use several CPU threads (SharedArrayBuffer).
// The Android app adds the same headers in MainActivity.
const crossOriginIsolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
}

export default defineConfig({
  // Relative base so the same build works on github.io/<repo>/ and on a custom domain.
  base: './',
  plugins: [react()],
  server: { headers: crossOriginIsolation },
  preview: { headers: crossOriginIsolation },
})
