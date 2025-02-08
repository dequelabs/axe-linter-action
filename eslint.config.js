const globals = require('globals')
const eslint = require('@eslint/js')
const tseslint = require('typescript-eslint')

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
      '@typescript-eslint': tseslint.plugin
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
    ignores: ['**/node_modules/', '**/dist/', '**/coverage/', '**/.nyc_output/']
  }
]
