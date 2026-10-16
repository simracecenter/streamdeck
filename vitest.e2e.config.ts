// SPDX-License-Identifier: GPL-3.0-or-later
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/e2e/**/*.test.ts"],
    testTimeout: 15_000,
    hookTimeout: 15_000,
  },
});
