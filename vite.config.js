import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // If you have path aliases in your project, add them here
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