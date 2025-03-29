import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    },
    extensions: ['.js', '.jsx', '.json']
  },
  optimizeDeps: {
    esbuildOptions: {
      // Required for core-js BigInt polyfill to work correctly
      define: {
        global: 'globalThis',
      },
      jsx: 'automatic', // Tell esbuild to handle JSX
      loader: {
        '.js': 'jsx' // Treat .js files as JSX
      }
    },
  },
});