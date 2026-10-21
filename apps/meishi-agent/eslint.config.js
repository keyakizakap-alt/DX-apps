// ESLint (flat config) with Expo's recommended rules plus security rules for this app.
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  { ignores: ['dist/*', 'public/*', 'test-results/*', '.expo/*', 'node_modules/*'] },
  {
    rules: {
      '@typescript-eslint/no-redeclare': 'off', // Zod schema + inferred type share a name by design
      'no-eval': 'error',
      'no-new-func': 'error',
      'no-implied-eval': 'error',
      'react/no-danger': 'error',
      'no-restricted-syntax': [
        'error',
        { selector: "MemberExpression[property.name='innerHTML']", message: 'innerHTML は使わない（XSS対策）' },
        { selector: "CallExpression[callee.object.name='localStorage']", message: '名刺データや鍵を localStorage に保存しない' },
        { selector: "CallExpression[callee.object.name='sessionStorage']", message: '名刺データや鍵を sessionStorage に保存しない' },
      ],
    },
  },
]);
