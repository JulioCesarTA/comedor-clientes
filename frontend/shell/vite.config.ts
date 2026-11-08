import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import federation from '@originjs/vite-plugin-federation';

// SHELL = HOST de Module Federation
// Importa remotes en runtime: portal (React) y backoffice (Angular Elements)
export default defineConfig({
  plugins: [
    react(),
    federation({
      name: 'shell',
      remotes: {
        portal: process.env.VITE_REMOTE_PORTAL || 'http://localhost:3002/assets/remoteEntry.js',
      },
      shared: ['react', 'react-dom'],
    }),
  ],
  server: { port: 3000, host: '0.0.0.0', cors: true },
  build: {
    target: 'esnext',
    minify: false,
    cssCodeSplit: false,
  },
  preview: { port: 3000, host: '0.0.0.0' },
});
