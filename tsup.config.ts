import { defineConfig } from 'tsup';

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/cli-run.ts',
    'src/express.ts',
    'src/fastify.ts',
    'src/next.ts',
  ],
  splitting: true,
  clean: true,
  format: ['cjs', 'esm'],
  dts: true,
  shims: true,
  onSuccess: 'npm run copy-json-files-to-dist',
});
