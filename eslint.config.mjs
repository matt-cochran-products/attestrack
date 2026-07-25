import eslint from '@eslint/js'
import globals from 'globals'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/.turbo/**',
      'pnpm-lock.yaml',
      '**/*.generated.ts',
      '**/rollup.config.js',
      'tooling/vitest/setup.ts',
      'e2e/scripts/**',
      'deploy/local/**',
      'e2e/node_modules/**',
      'e2e/playwright-report/**',
      'e2e/test-results/**'
    ]
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.es2022 }
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }
      ],
      'no-console': ['warn', { allow: ['warn', 'error'] }]
    }
  },
  {
    files: ['packages/worker-core/**/*.ts', 'packages/strategies/**/*.ts'],
    languageOptions: { globals: { ...globals.worker } },
    rules: { 'no-console': 'off' }
  },
  {
    files: ['packages/host-cloudflare-worker/**/*.ts'],
    languageOptions: { globals: { ...globals.worker } },
    rules: { 'no-console': 'off' }
  },
  {
    files: ['packages/portal-community/**/*.{ts,tsx}'],
    plugins: {
      react,
      'react-hooks': reactHooks
    },
    languageOptions: {
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser }
    },
    settings: {
      react: {
        version: 'detect'
      }
    },
    rules: {
      ...react.configs.flat['jsx-runtime'].rules,
      ...reactHooks.configs.flat.recommended.rules,
      'react/prop-types': 'off',
      // Fetch-on-mount hooks legitimately set loading state at effect start; rule is overly strict for this codebase.
      'react-hooks/set-state-in-effect': 'off'
    }
  },
  {
    files: ['packages/**/*.tsx'],
    ignores: ['packages/portal-community/**'],
    languageOptions: {
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser }
    }
  },
  {
    files: ['packages/consent-js/**/*.ts'],
    languageOptions: { globals: { ...globals.browser } }
  },
  {
    files: ['**/*.test.ts', '**/*.test.tsx', 'tooling/vitest/**/*.ts'],
    languageOptions: { globals: { ...globals.es2022, ...globals.node } },
    rules: { 'no-console': 'off' }
  },
  {
    files: ['scripts/**/*.mjs', 'packages/*/scripts/**/*.mjs'],
    languageOptions: { globals: { ...globals.node } },
    rules: { 'no-console': 'off' }
  },
  {
    files: ['packages/deploy/src/**/*.ts'],
    rules: { 'no-console': 'off' }
  }
)
