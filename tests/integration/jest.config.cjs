const config = require('../reporting/jest.config.cjs');
module.exports = {
  ...config,
  moduleNameMapper: {
    ...config.moduleNameMapper,
    '^@gitroom/frontend/(.*)$': '<rootDir>/apps/frontend/src/$1',
    '^@gitroom/react/(.*)$':
      '<rootDir>/libraries/react-shared-libraries/src/$1',
  },
  testMatch: [
    '<rootDir>/tests/inbox/**/*.spec.ts',
    '<rootDir>/tests/reporting/**/*.spec.ts',
    '<rootDir>/tests/integration/**/*.spec.ts',
    '<rootDir>/tests/integration/**/*.spec.tsx',
  ],
};
