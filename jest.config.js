export default {
  preset: "ts-jest/presets/js-with-ts",
  testEnvironment: "jest-environment-node",
  extensionsToTreatAsEsm: [".ts"],
  transform: {
    "^.+\\.(ts|tsx)$": [
      "ts-jest",
      {
        useESM: true,
      },
    ],
  },
  modulePathIgnorePatterns: [],
  transformIgnorePatterns: ["<rootDir>/node_modules/", "<rootDir>/dist/"],
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  testTimeout: 1_000_000,
  setupFilesAfterEnv: ["<rootDir>/jest.setup.ts"],
  verbose: true,
  testMatch: ["<rootDir>/tests/**/*.test.ts"],
  moduleFileExtensions: [
    "js",
    "mjs",
    "cjs",
    "jsx",
    "ts",
    "tsx",
    "json",
    "node",
  ],
};
