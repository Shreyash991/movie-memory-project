import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Tests run against a real Postgres (the advisory lock can't be meaningfully mocked).
// Defaults to the movie_memory_test database created by docker-compose.
const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5432/movie_memory_test?schema=public";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
  },
  test: {
    environment: "node",
    env: { DATABASE_URL: TEST_DATABASE_URL },
    globalSetup: ["./tests/global-setup.ts"],
    // Test files share one database, so run them one at a time.
    fileParallelism: false,
  },
});
