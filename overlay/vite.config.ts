import { defineConfig } from 'vite';

export default defineConfig({
  base: '/overlay/',
  server: { proxy: { '/events': 'http://127.0.0.1:3000' } },
});
