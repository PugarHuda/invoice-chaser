// Used by `vite build` only (dev uses the inline config in server/index.mjs).
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
export default defineConfig({ plugins: [react()], build: { outDir: 'public', emptyOutDir: true } })
