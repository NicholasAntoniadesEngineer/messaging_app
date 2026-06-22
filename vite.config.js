import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  base: './',
  server: {
    port: 3000,
    open: '/landing/index.html',
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
        landing: 'landing/index.html',
        auth: 'auth/views/auth.html',
        monthlyBudget: 'monthlyBudget/views/monthlyBudget.html',
        pots: 'pots/views/pots.html',
        settings: 'settings/views/settings.html',
        notifications: 'notifications/views/notifications.html',
        subscription: 'payments/views/subscription.html',
        messenger: 'messaging/views/messenger.html',
      },
    },
  },
});
