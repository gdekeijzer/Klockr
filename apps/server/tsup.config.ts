import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/main.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node24',
  sourcemap: true,
  clean: true,
  // Workspace packages ship TypeScript source; bundle them into the app output.
  noExternal: [/^@klockr\//],
  // Bundled CommonJS dependencies (e.g. pg) need `require` inside the ESM output.
  banner: {
    js: "import { createRequire as __klockrCreateRequire } from 'node:module'; const require = __klockrCreateRequire(import.meta.url);",
  },
});
