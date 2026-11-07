// ESLint config for repo-root .js files (scripts/, tooling). The apps have
// their own .eslintrc.cjs each; this one exists so `eslint` (and the
// lint-staged pre-commit hook) finds a config for files outside apps/.
module.exports = {
  extends: ['airbnb-base', 'prettier'],
  env: {
    node: true,
    es2022: true
  },
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'script'
  },
  rules: {
    'import/no-extraneous-dependencies': ['error', { devDependencies: true }],
    'class-methods-use-this': 'off',
    'no-underscore-dangle': 'off',
    'no-param-reassign': 'off',
    'consistent-return': 'off',
    'no-console': 'off'
  }
};
