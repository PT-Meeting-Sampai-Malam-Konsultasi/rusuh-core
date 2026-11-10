module.exports = {
  clearMocks: true,
  collectCoverageFrom: ['src/**/*.js', '!src/server.js'],
  coverageDirectory: 'coverage',
  coverageReporters: ['json', 'text', 'lcov', 'cobertura'],
  coverageProvider: 'v8',
  // Enforced coverage floor (user decision, 7 Nov 2026): every metric must
  // stay >= 80%. `npm run check` fails below this.
  coverageThreshold: {
    global: { branches: 80, functions: 80, lines: 80, statements: 80 }
  },
  detectOpenHandles: true,
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1'
  },
  reporters: ['default', 'jest-sonar', ['jest-junit', { outputDirectory: 'coverage', outputName: 'junit.xml' }]],
  resetMocks: true,
  restoreMocks: true,
  setupFiles: ['<rootDir>/jest.setup.js'],
  testEnvironment: 'node',
  // Only *.test.js files are suites: __tests__/ also holds test support
  // files (e.g. test-fixtures.js), which the default '**/__tests__/**'
  // pattern would otherwise run as an empty suite and fail.
  testMatch: ['**/__tests__/**/*.test.js', '**/?(*.)+(spec|test).js']
};
