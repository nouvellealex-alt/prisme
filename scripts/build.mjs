import { build } from 'vite';

const shared = { target: 'chrome120', outDir: 'dist', sourcemap: false };

await build({
  configFile: false,
  build: { ...shared, rollupOptions: { input: 'popup.html' } },
});

for (const [name, entry, format] of [
  ['background', 'src/background.ts', 'es'],
  ['content', 'src/content/index.ts', 'iife'],
]) {
  await build({
    configFile: false,
    publicDir: false,
    build: {
      ...shared,
      emptyOutDir: false,
      lib: { entry, name: 'Prisme', formats: [format], fileName: () => `${name}.js` },
    },
  });
}
