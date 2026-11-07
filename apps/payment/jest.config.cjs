module.exports = {
  clearMocks: true,
  collectCoverageFrom: ['src/**/*.js', '!src/server.js'],
  coverageDirectory: 'coverage',
  coverageReporters: ['json', 'text', 'lcov', 'cobertura'],
  coverageProvider: 'v8',
  detectOpenHandles: true,
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1'
  },
  reporters: ['default', 'jest-sonar', ['jest-junit', { outputDirectory: 'coverage', outputName: 'junit.xml' }]],
  resetMocks: true,
  restoreMocks: true,
  setupFiles: ['<rootDir>/jest.setup.js'],
  testEnvironment: 'node',
  // webhook-test-harness.js is a test helper living in __tests__/ (so the
  // Onion boundary check exempts it); it holds no tests, so jest must not
  // collect it as a suite.
  testPathIgnorePatterns: ['/node_modules/', 'webhook-test-harness']
};
