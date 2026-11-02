const config = require('../reporting/jest.config.cjs');
module.exports = {
  ...config,
  testMatch: [
    '<rootDir>/tests/inbox/**/*.spec.ts',
    '<rootDir>/tests/reporting/**/*.spec.ts',
    '<rootDir>/tests/integration/**/*.spec.ts',
  ],
};
