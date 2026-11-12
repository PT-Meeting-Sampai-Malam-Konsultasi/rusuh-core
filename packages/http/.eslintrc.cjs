module.exports = {
  extends: ['airbnb-base', 'prettier'],
  plugins: ['jest', 'import'],
  env: { node: true, es2022: true, 'jest/globals': true },
  parserOptions: { ecmaVersion: 2022, sourceType: 'script' },
  rules: {
    'import/no-unresolved': ['error', { commonjs: true, amd: true }],
    'import/no-extraneous-dependencies': ['error', { devDependencies: true }],
    'class-methods-use-this': 'off',
    'no-underscore-dangle': 'off',
    'no-param-reassign': 'off',
    'consistent-return': 'off',
    'no-console': 'warn'
  }
};
