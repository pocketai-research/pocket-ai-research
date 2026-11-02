import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // Relative base so the same build works on github.io/<repo>/ and on a custom domain.
  base: './',
  plugins: [react()],
})
