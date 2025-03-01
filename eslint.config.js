const globals = require('globals')
const eslint = require('@eslint/js')
const tseslint = require('typescript-eslint')
const mocha = require('eslint-plugin-mocha')

module.exports = [
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      parser: tseslint.parser,
      globals: {
        ...globals.node,
        ...globals.es2015
      }
    },
    plugins: {
      '@typescript-eslint': tseslint.plugin,
      mocha
    }
  },
  {
    files: ['eslint.config.js'],
    rules: {
      '@typescript-eslint/no-var-requires': 'off',
      '@typescript-eslint/no-require-imports': 'off'
    }
  },
  {
    files: ['src/**/*.test.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      'mocha/no-exclusive-tests': 'error',
      'mocha/no-setup-in-describe': 'off',
      'mocha/max-top-level-suites': 'off',
      'mocha/no-mocha-arrows': 'off'
    }
  },
  {
    ignores: ['**/node_modules/', '**/dist/', '**/coverage/', '**/.nyc_output/']
  }
]
