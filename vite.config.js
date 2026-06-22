import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  base: './',
  server: {
    port: 3000,
    open: '/messaging/views/messenger.html',
    cors: true,
  },
  css: {
    transformer: 'lightningcss',
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: 'index.html',
        auth: 'auth/views/auth.html',
        messenger: 'messaging/views/messenger.html',
        subscription: 'payments/views/subscription.html',
      },
    },
  },
});
