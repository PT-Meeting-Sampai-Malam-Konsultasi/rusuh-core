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
  testEnvironment: 'node'
};
