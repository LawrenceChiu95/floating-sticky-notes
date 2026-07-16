import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          main: resolve(__dirname, 'main/main.ts')
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          preload: resolve(__dirname, 'preload/preload.ts'),
          updateProgressPreload: resolve(__dirname, 'preload/update-progress-preload.ts'),
          releaseFeedbackPreload: resolve(
            __dirname,
            'preload/release-feedback-preload.ts'
          )
        },
        output: {
          format: 'cjs'
        }
      }
    }
  },
  renderer: {
    root: resolve(__dirname, 'renderer'),
    plugins: [react()],
    server: {
      hmr: false
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'renderer/index.html'),
          updateProgress: resolve(__dirname, 'renderer/update-progress.html'),
          releaseFeedback: resolve(__dirname, 'renderer/release-feedback.html')
        }
      }
    }
  }
});
