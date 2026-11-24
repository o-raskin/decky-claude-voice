import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  esbuild: { jsx: "transform", jsxFactory: "window.SP_REACT.createElement", jsxFragment: "window.SP_REACT.Fragment" },
  resolve: {
    alias: {
      "@decky/ui": resolve(__dirname, "tests/ts/mocks/decky-ui.tsx"),
      "@decky/api": resolve(__dirname, "tests/ts/mocks/decky-api.ts"),
    },
  },
  test: {
    environment: "jsdom",
    include: ["tests/ts/**/*.test.{ts,tsx}"],
    setupFiles: ["tests/ts/setup.ts"],
    restoreMocks: false,
    coverage: {
      provider: "v8",
      include: ["src/**"],
      reporter: ["text"],
      thresholds: { statements: 100, branches: 97, functions: 100, lines: 100 },
    },
  },
});
