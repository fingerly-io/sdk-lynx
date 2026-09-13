import { pluginReactLynx } from '@lynx-js/react-rsbuild-plugin';
import { defineConfig } from '@lynx-js/rspeedy';

export default defineConfig({
  source: {
    entry: {
      main: './src/index.tsx',
    },
  },
  // Rspeedy's current compiler emits through 3.9; Lynx 4.1 hosts retain
  // compatibility with that bundle format.
  plugins: [pluginReactLynx({ engineVersion: '3.9' })],
});
