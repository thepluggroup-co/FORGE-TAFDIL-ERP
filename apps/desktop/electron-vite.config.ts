import { defineConfig } from 'electron-vite';

export default defineConfig({
  main: {
    entry: 'src/main.ts',
  },
  preload: {
    entry: 'src/preload.ts',
  },
  renderer: {
    entry: 'index.html',
  },
});
