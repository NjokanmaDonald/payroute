import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';

export default defineConfig({
  plugins: [react()],
  css: {
    postcss: {
      plugins: [tailwindcss, autoprefixer],
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/payments': 'http://backend:3001',
      '/accounts': 'http://backend:3001',
      '/webhooks': 'http://backend:3001',
    },
  },
});
