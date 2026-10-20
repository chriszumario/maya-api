import { aot } from 'elysia/plugin/aot/bun';

await Bun.build({
  entrypoints: ['src/index.ts'],
  outdir: 'dist',
  target: 'bun',
  minify: true,
  sourcemap: 'linked',
  plugins: [aot('src/index.ts')],
});
