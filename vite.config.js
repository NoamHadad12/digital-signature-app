import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: 'localhost',  // Bind to localhost only for local dev — change to 'true' if LAN access is needed
    port: 5175,
    strictPort: true,  // Fail fast if 5175 is taken — prevents silent escape to another port
    proxy: {
      // Route /api/* to the local API dev server (dev-server.js on port 3001).
      // In production, Vercel handles /api/* as serverless functions directly.
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
})
