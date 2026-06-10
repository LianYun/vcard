import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Vite config tuned for Tauri:
// - Pre-bundle Tauri API (and marked) so dynamic imports don't trigger
//   "Outdated Optimize Dep" 504 errors when the dep graph changes.
// - Fixed dev port matching tauri.conf.json#build.devUrl.
// - clearScreen: false so Tauri's terminal output stays visible.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
  },
  optimizeDeps: {
    include: ['@tauri-apps/api/core', 'marked'],
  },
})
