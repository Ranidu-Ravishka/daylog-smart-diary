// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '^(\\.\\./)+(apps|packages)/',
              message:
                'Use package alias import instead of deep relative import',
            },
          ],
        },
      ],
    },
  },
  {
    ignores: ['dist/*'],
  },
]);
