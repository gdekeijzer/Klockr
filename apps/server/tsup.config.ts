import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/main.ts', 'src/migrate.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node24',
  sourcemap: true,
  clean: true,
  // Workspace packages ship TypeScript source; bundle them into the app output.
  noExternal: [/^@klockr\//],
  // Ship SQL migrations with the bundle so the deployable artifact can migrate itself.
  onSuccess: 'rm -rf dist/migrations && cp -R ../../packages/db/migrations dist/migrations',
  // Bundled CommonJS dependencies (e.g. pg) need `require` inside the ESM output.
  banner: {
    js: "import { createRequire as __klockrCreateRequire } from 'node:module'; const require = __klockrCreateRequire(import.meta.url);",
  },
});
