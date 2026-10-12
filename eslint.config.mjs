// Configuration ESLint 9 (flat config) commune à tout le monorepo.
// Chaque package lance `eslint` depuis son dossier ; ESLint remonte jusqu'ici.
import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/dist-electron/**',
      '**/out/**',
      '**/release/**',
      '**/build/**',
      '**/.next/**',
      '**/.turbo/**',
      '**/.vercel/**',
      '**/coverage/**',
      '**/dev-dist/**',
      '**/android/**',
      '**/ios/**',
      '**/public/**',
      '**/*.min.js',
      '**/next-env.d.ts',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node },
    },
    linterOptions: {
      // Des commentaires eslint-disable hérités visent des règles de plugins
      // non installés ici : ils ne doivent pas faire échouer le lint.
      reportUnusedDisableDirectives: 'off',
    },
    rules: {
      // Le typage est vérifié par tsc (étape build) : ces règles restent des
      // signalements, pas des blocages, tant que l'existant n'est pas nettoyé.
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
        ignoreRestSiblings: true,
      }],
      '@typescript-eslint/no-empty-object-type': 'warn',
      '@typescript-eslint/no-require-imports': 'warn',
      '@typescript-eslint/no-unused-expressions': 'warn',
      '@typescript-eslint/ban-ts-comment': 'warn',
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'no-useless-escape': 'warn',
      'no-control-regex': 'warn',
      'no-case-declarations': 'warn',
      'no-prototype-builtins': 'warn',
      'prefer-const': 'warn',
      // Espaces insécables voulus dans les formats de nombres et de montants
      'no-irregular-whitespace': ['error', { skipStrings: true, skipTemplates: true, skipRegExps: true, skipComments: true }],
    },
  },

  // React : règles des hooks pour les applications et la bibliothèque UI
  {
    files: ['**/*.{tsx,jsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },

  // Fichiers CommonJS (scripts, configurations d'outils)
  {
    files: ['**/*.cjs'],
    languageOptions: { sourceType: 'commonjs' },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },

  // Tests : mocks et assertions tolèrent plus de souplesse
  {
    files: ['**/__tests__/**', '**/*.test.{ts,tsx}', '**/*.spec.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },
)
