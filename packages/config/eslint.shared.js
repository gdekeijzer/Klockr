// Shared KLOCKR ESLint flat config.
// Architecture boundaries are enforced here: domain/application must stay framework-independent.
import js from '@eslint/js';
import nextPlugin from '@next/eslint-plugin-next';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const frameworkImports = [
  { group: ['next', 'next/*', '@next/*'], message: 'Framework code is not allowed here.' },
  { group: ['react', 'react-dom', 'react/*'], message: 'UI code is not allowed here.' },
  {
    group: ['fastify', '@fastify/*', 'socket.io', 'socket.io-*'],
    message: 'Transport code is not allowed here.',
  },
  {
    group: ['drizzle-orm', 'drizzle-orm/*', 'pg', 'postgres'],
    message: 'Persistence belongs in @klockr/db.',
  },
  { group: ['pino', 'pino-*'], message: 'Logging is injected by apps.' },
];

/** @param {{ rootDir: string }} options */
export function klockrEslintConfig({ rootDir }) {
  return tseslint.config(
    {
      ignores: [
        '**/node_modules/**',
        '**/dist/**',
        '**/.next/**',
        '**/.turbo/**',
        '**/coverage/**',
        '**/next-env.d.ts',
        'docs/**',
        'packages/db/migrations/**',
      ],
    },
    js.configs.recommended,
    ...tseslint.configs.strictTypeChecked,
    {
      languageOptions: {
        parserOptions: {
          projectService: true,
          tsconfigRootDir: rootDir,
        },
        globals: { ...globals.node },
      },
      rules: {
        '@typescript-eslint/no-explicit-any': 'error',
        '@typescript-eslint/consistent-type-imports': 'error',
        '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
        '@typescript-eslint/no-unused-vars': [
          'error',
          { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
        ],
      },
    },
    {
      files: ['**/*.{js,mjs,cjs}'],
      ...tseslint.configs.disableTypeChecked,
    },
    {
      files: ['packages/domain/**/*.ts'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              ...frameworkImports,
              { group: ['zod', 'zod/*'], message: 'Domain stays dependency-free.' },
              { group: ['@klockr/*'], message: 'Domain must not depend on other KLOCKR packages.' },
            ],
          },
        ],
      },
    },
    {
      files: ['packages/application/**/*.ts'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              ...frameworkImports,
              {
                group: ['@klockr/db', '@klockr/ui'],
                message: 'Application uses ports, not adapters.',
              },
            ],
          },
        ],
      },
    },
    {
      files: ['packages/contracts/**/*.ts'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              ...frameworkImports,
              { group: ['@klockr/db'], message: 'Contracts must not mirror database models.' },
            ],
          },
        ],
      },
    },
    {
      files: ['apps/web/**/*.{ts,tsx}', 'packages/ui/**/*.{ts,tsx}'],
      languageOptions: { globals: { ...globals.browser } },
      plugins: { 'react-hooks': reactHooks, '@next/next': nextPlugin },
      rules: {
        ...reactHooks.configs.recommended.rules,
        ...nextPlugin.configs.recommended.rules,
        ...nextPlugin.configs['core-web-vitals'].rules,
      },
      settings: { next: { rootDir: 'apps/web' } },
    },
  );
}
