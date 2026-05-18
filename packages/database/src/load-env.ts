import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";

function findMonorepoRoot(startDir: string): string | null {
  let dir = startDir;

  while (dir !== dirname(dir)) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) {
      return dir;
    }

    dir = dirname(dir);
  }

  return null;
}

/**
 * Loads the monorepo root `.env` so DATABASE_URL is available regardless of
 * which app's working directory imported `@pulseguard/database`.
 */
export function loadRootEnv(): void {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const root =
    findMonorepoRoot(moduleDir) ?? findMonorepoRoot(process.cwd());

  if (!root) {
    return;
  }

  const envPath = join(root, ".env");

  if (existsSync(envPath)) {
    config({ path: envPath });
  }
}
