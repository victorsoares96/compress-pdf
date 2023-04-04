import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/**/*'],
  splitting: true,
  clean: true,
  format: ['cjs', 'esm'],
  dts: true,
  onSuccess: 'npm run copy-json-files-to-dist',
});
