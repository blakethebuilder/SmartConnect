import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// ponytail: prod baseURL '' (nginx same-origin proxy); dev hits PB directly on 8090
export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/pb': { target: 'http://127.0.0.1:8090', rewrite: p => p.replace(/^\/pb/, '') } } },
})
