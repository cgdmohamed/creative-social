module.exports = {
  rootDir: '../..',
  testEnvironment: 'node',
  moduleDirectories: [
    process.env.INBOX_TEST_MODULES || 'node_modules',
    'node_modules',
  ],
  testMatch: ['<rootDir>/tests/inbox/**/*.spec.ts'],
  transform: {
    '^.+\\.tsx?$': [
      process.env.INBOX_TEST_MODULES
        ? require('path').join(process.env.INBOX_TEST_MODULES, 'ts-jest')
        : 'ts-jest',
      {
        isolatedModules: true,
        tsconfig: {
          target: 'ES2020',
          module: 'commonjs',
          esModuleInterop: true,
          experimentalDecorators: true,
          emitDecoratorMetadata: true,
        },
        diagnostics: false,
      },
    ],
  },
  moduleNameMapper: {
    '^@gitroom/backend/(.*)$': '<rootDir>/apps/backend/src/$1',
    '^@gitroom/nestjs-libraries/(.*)$':
      '<rootDir>/libraries/nestjs-libraries/src/$1',
    '^@gitroom/helpers/(.*)$': '<rootDir>/libraries/helpers/src/$1',
  },
};
