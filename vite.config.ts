import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Map react-native → react-native-web (absolute path avoids the alias loop)
      'react-native': path.resolve(__dirname, 'node_modules/react-native-web'),
      // Stub out native-only packages that can't work on web
      'react-native-safe-area-context': path.resolve(__dirname, 'src/stubs/safe-area.ts'),
      'react-native-screens': path.resolve(__dirname, 'src/stubs/screens.ts'),
      'react-native-gesture-handler': path.resolve(__dirname, 'src/stubs/gesture-handler.ts'),
      'react-native-reanimated': path.resolve(__dirname, 'src/stubs/reanimated.ts'),
    },
    extensions: [
      '.web.tsx', '.web.ts', '.web.jsx', '.web.js',
      '.tsx', '.ts', '.jsx', '.js',
    ],
  },
  optimizeDeps: {
    include: ['react-native-web'],
    exclude: ['lucide-react'],
    esbuildOptions: {
      resolveExtensions: ['.web.js', '.web.ts', '.web.tsx', '.js', '.ts', '.tsx'],
      define: {
        global: 'window',
        __DEV__: 'false',
      },
    },
  },
  define: {
    global: 'window',
    __DEV__: JSON.stringify(process.env.NODE_ENV !== 'production'),
  },
});
