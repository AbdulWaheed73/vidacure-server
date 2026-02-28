import type { Config } from "jest";

const config: Config = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/src"],
  testMatch: ["**/__tests__/**/*.test.ts"],
  moduleFileExtensions: ["ts", "js", "json"],
  setupFiles: ["<rootDir>/src/__tests__/env-setup.ts"],
  // Don't run server.ts which starts listening
  modulePathIgnorePatterns: ["<rootDir>/dist/"],
  // Increase timeout for DB operations
  testTimeout: 15000,
};

export default config;
