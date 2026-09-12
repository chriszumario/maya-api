import { aot } from "elysia/plugin/aot/bun";


const result = await Bun.build({
  entrypoints: ['src/index.ts'],
  outdir: 'dist',
  target: 'bun',
  minify: true,
  sourcemap: 'linked',
  plugins: [
    aot('src/index.ts'),
  ],
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
