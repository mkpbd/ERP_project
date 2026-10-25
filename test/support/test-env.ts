/**
 * Environment for integration and e2e tests. TEST_DATABASE_URL is required and
 * must point at a disposable database whose name contains "test": the global
 * setup drops and recreates its public schema.
 */
export function testEnvironment(): Record<string, string> {
  try {
    process.loadEnvFile();
  } catch {
    // CI provides variables directly.
  }
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL must be set for integration/e2e tests');
  const databaseName = new URL(url).pathname.slice(1);
  if (!/test/i.test(databaseName)) {
    throw new Error(`Refusing to use "${databaseName}" for tests: the database name must contain "test"`);
  }
  return {
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: url,
    DATABASE_POOL_MAX: '10',
    JWT_ISSUER: 'erp-test',
    JWT_AUDIENCE: 'erp-test-clients',
    JWT_SIGNING_KEYS:
      'test-k2:test-signing-secret-number-two-0123456789abcdef,test-k1:test-signing-secret-number-one-0123456789abcdef',
    CORS_ORIGINS: 'http://localhost:5173',
    COOKIE_SECURE: 'false',
    REGISTRATION_ENABLED: 'true',
    EMAIL_VERIFICATION_REQUIRED: 'true',
    LOGIN_MAX_FAILED_ATTEMPTS: '3',
    LOGIN_LOCKOUT_SECONDS: '900',
    PERMISSION_CACHE_TTL: '30',
    RATE_LIMIT_LIMIT: '100000',
    AUTH_RATE_LIMIT_LIMIT: '100000',
    APP_PUBLIC_URL: 'http://localhost:5173',
    MAIL_FROM: 'ERP Test <test@example.com>',
    MAIL_TRANSPORT: 'memory',
    OUTBOX_POLL_INTERVAL_MS: '0',
    SWAGGER_ENABLED: 'true',
  };
}
