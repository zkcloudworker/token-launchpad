export default {
  preset: "ts-jest/presets/js-with-ts",
  testEnvironment: "node",
  extensionsToTreatAsEsm: [".ts"],
  modulePathIgnorePatterns: [],
  transform: {
    "^.+\\.(ts|tsx)$": [
      "ts-jest",
      {
        useESM: true,
      },
    ],
  },
  transformIgnorePatterns: ["<rootDir>/node_modules/", "<rootDir>/dist/"],
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  testTimeout: 1_000_000,
  setupFilesAfterEnv: ["<rootDir>/jest.setup.ts"],
  verbose: true,
  testMatch: ["<rootDir>/tests/**/*.test.ts"],
};
