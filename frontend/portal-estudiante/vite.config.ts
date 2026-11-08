import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import federation from '@originjs/vite-plugin-federation';

// PORTAL = REMOTE del Module Federation
// Expone ./App para que el shell lo importe en runtime
export default defineConfig({
  plugins: [
    react(),
    federation({
      name: 'portal',
      filename: 'remoteEntry.js',
      exposes: {
        './App': './src/App.tsx',
      },
      shared: ['react', 'react-dom'],
    }),
  ],
  server: { port: 3002, host: '0.0.0.0', cors: true },
  build: {
    target: 'esnext',
    minify: false,
    cssCodeSplit: false,
    modulePreload: false,
  },
  preview: { port: 3002, host: '0.0.0.0', cors: true },
});
