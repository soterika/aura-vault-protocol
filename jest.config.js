/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: {
        target: 'ES2020',
        module: 'commonjs',
        moduleResolution: 'node',
        esModuleInterop: true,
        strict: false,
        skipLibCheck: true,
      },
      // Disable TypeScript diagnostics so missing optional imports (e.g. logger.js
      // from the backend monorepo) don't block the test run. Runtime errors from
      // the dynamic import are caught and fall back to console in the listener.
      diagnostics: false,
    }],
    // Transform ESM-only node_modules (uuid v14 ships as pure ESM)
    '^.+\\.m?js$': ['ts-jest', {
      tsconfig: {
        allowJs: true,
        module: 'commonjs',
        esModuleInterop: true,
        skipLibCheck: true,
      },
      diagnostics: false,
    }],
  },
  // Allow uuid and other pure-ESM packages to be transformed by ts-jest
  transformIgnorePatterns: [
    '/node_modules/(?!(uuid|prom-client)/)',
  ],
  moduleNameMapper: {
    // Map .js extension imports to the source files (ESM → CJS compat)
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  // Increase timeout for async tests with fake timers
  testTimeout: 15000,
};
