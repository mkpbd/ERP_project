/** Loads .env when present without overriding variables already set (same behaviour as main.ts). */
export function loadLocalEnv(): void {
  try {
    process.loadEnvFile();
  } catch {
    // No .env file present.
  }
}
