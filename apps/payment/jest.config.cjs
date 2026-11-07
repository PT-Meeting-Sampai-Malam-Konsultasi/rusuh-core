module.exports = {
  clearMocks: true,
  collectCoverageFrom: ['src/**/*.js', '!src/server.js'],
  coverageDirectory: 'coverage',
  coverageReporters: ['json', 'text', 'lcov', 'cobertura'],
  coverageProvider: 'v8',
  // Enforced minimum (team decision, 7 Nov 2026): every metric must stay
  // >= 80%. Pure JSDoc port files (domain/ports/*.js, `module.exports = {}`)
  // are included and pull the total down, so the margin above 80% is
  // intentionally kept comfortable.
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
  // webhook-test-harness.js is a test helper living in __tests__/ (so the
  // Onion boundary check exempts it); it holds no tests, so jest must not
  // collect it as a suite.
  testPathIgnorePatterns: ['/node_modules/', 'webhook-test-harness']
};
