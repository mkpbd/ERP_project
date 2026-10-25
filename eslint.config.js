import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const INFRASTRUCTURE_PACKAGES = ['drizzle-orm', 'drizzle-orm/*', 'pg', 'express', 'argon2', 'jose', 'nodemailer'];

export default defineConfig(
  { ignores: ['dist/', 'coverage/', 'node_modules/', 'var/', 'src/database/migrations/', 'eslint.config.js'] },
  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      globals: globals.node,
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_' },
      ],
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },
  // NestJS resolves constructor parameters from emitted type metadata, so
  // injected classes must be value imports even when only used as types.
  {
    files: ['src/**/*.ts'],
    rules: { '@typescript-eslint/consistent-type-imports': 'off' },
  },
  // Layer boundaries (also enforced by test/architecture).
  {
    files: ['src/**/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@nestjs/*', ...INFRASTRUCTURE_PACKAGES, '**/application/**', '**/infrastructure/**', '**/presentation/**', '**/database/**'],
              message: 'The domain layer must not depend on frameworks, persistence or outer layers.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/**/application/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [...INFRASTRUCTURE_PACKAGES, '**/infrastructure/**', '**/presentation/**', '**/database/**'],
              message: 'The application layer depends on ports, not on infrastructure or presentation.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/cli/**/*.ts'],
    rules: { 'no-console': 'off' },
  },
  {
    files: ['test/**/*.ts'],
    rules: {
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      // HTTP response bodies (supertest) and decoded JWT payloads are untyped JSON by nature;
      // tests assert their shape explicitly instead.
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
    },
  },
  prettier,
);
