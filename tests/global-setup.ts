import { execSync } from "node:child_process";
import type { TestProject } from "vitest/node";

// Applies migrations to the test database once before the suite runs.
export default function setup(project: TestProject) {
  const url = project.config.env.DATABASE_URL ?? "";
  // Guard against wiping a real database: the suite truncates tables.
  if (!/test/i.test(new URL(url).pathname)) {
    throw new Error(`Refusing to run tests against non-test database: ${url}`);
  }
  execSync("npx prisma migrate deploy", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: url },
  });
}
