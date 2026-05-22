import { fileURLToPath } from 'node:url';
import { resolve } from 'path';

import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const projectRootDir = fileURLToPath(new URL('.', import.meta.url));
  const devHost = env.VITE_DEV_HOST ?? 'localhost';
  const devPort = Number(env.VITE_DEV_PORT ?? 3000);
  const backendTarget = env.VITE_DEV_BACKEND_TARGET ?? 'http://localhost:8080';
  const hmrPort = env.VITE_HMR_PORT ? Number(env.VITE_HMR_PORT) : devPort;
  const hmrHost = env.VITE_HMR_HOST ?? devHost;
  const hmrProtocolEnv = env.VITE_HMR_PROTOCOL ?? 'ws';
  const hmrProtocol = hmrProtocolEnv === 'wss' ? 'wss' : 'ws';
  return {
    resolve: {
      alias: {
        '@': resolve(projectRootDir, 'src'),
      },
    },
    plugins: [react()],
    base: env.VITE_BASE_PATH || '/',
    build: {
      chunkSizeWarningLimit: 1024,
      outDir: 'dist',
      sourcemap: false,
    },
    css: {
      preprocessorOptions: {
        scss: {
          includePaths: ['node_modules'],
        },
      },
    },
    server: {
      host: devHost,
      port: devPort,
      hmr: {
        overlay: false,
        protocol: hmrProtocol,
        host: hmrHost,
        port: hmrPort,
      },
      proxy: {
        '/api': {
          target: backendTarget,
          changeOrigin: true,
          secure: false,
        },
      },
    },
    preview: {
      port: devPort,
    },
  };
});
