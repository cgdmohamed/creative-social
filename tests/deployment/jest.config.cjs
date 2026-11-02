const config = require('../reporting/jest.config.cjs');
module.exports = {
  ...config,
  roots: ['<rootDir>/tests/deployment', '<rootDir>/deploy/coolify/production'],
  testMatch: ['<rootDir>/tests/deployment/**/*.spec.ts'],
};
