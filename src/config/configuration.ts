import { envSchema, type Env } from './env.schema.js';

export interface AppConfig {
  readonly env: Env['NODE_ENV'];
  readonly isProduction: boolean;
  readonly port: number;
  readonly logLevel: Env['LOG_LEVEL'];
  readonly trustProxy: boolean;
  readonly database: { readonly url: string; readonly poolMax: number };
  readonly jwt: {
    readonly issuer: string;
    readonly audience: string;
    readonly signingKeys: ReadonlyArray<{ readonly kid: string; readonly secret: string }>;
    readonly accessTokenTtlSeconds: number;
    readonly refreshTokenTtlSeconds: number;
  };
  readonly http: {
    readonly corsOrigins: readonly string[];
    readonly cookieSecure: boolean;
    readonly swaggerEnabled: boolean;
  };
  readonly auth: {
    readonly registrationEnabled: boolean;
    readonly emailVerificationRequired: boolean;
    readonly maxFailedLoginAttempts: number;
    readonly lockoutSeconds: number;
    readonly passwordResetTokenTtlSeconds: number;
    readonly emailVerificationTokenTtlSeconds: number;
    readonly permissionCacheTtlSeconds: number;
  };
  readonly rateLimit: { readonly ttlSeconds: number; readonly limit: number; readonly authLimit: number };
  readonly mail: {
    readonly from: string;
    readonly transport: Env['MAIL_TRANSPORT'];
    readonly smtpUrl: string | undefined;
    readonly fileDir: string;
    readonly appPublicUrl: string;
    readonly outboxPollIntervalMs: number;
  };
}

export class ConfigValidationError extends Error {
  constructor(readonly issues: string[]) {
    super(`Invalid environment configuration:\n  - ${issues.join('\n  - ')}`);
    this.name = 'ConfigValidationError';
  }
}

export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    // Only paths and messages are reported; values may be secrets.
    throw new ConfigValidationError(
      parsed.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`),
    );
  }
  const env = parsed.data;
  return {
    env: env.NODE_ENV,
    isProduction: env.NODE_ENV === 'production',
    port: env.PORT,
    logLevel: env.LOG_LEVEL,
    trustProxy: env.TRUST_PROXY,
    database: { url: env.DATABASE_URL, poolMax: env.DATABASE_POOL_MAX },
    jwt: {
      issuer: env.JWT_ISSUER,
      audience: env.JWT_AUDIENCE,
      signingKeys: env.JWT_SIGNING_KEYS,
      accessTokenTtlSeconds: env.JWT_ACCESS_TOKEN_TTL,
      refreshTokenTtlSeconds: env.JWT_REFRESH_TOKEN_TTL,
    },
    http: {
      corsOrigins: env.CORS_ORIGINS,
      cookieSecure: env.COOKIE_SECURE,
      swaggerEnabled: env.SWAGGER_ENABLED,
    },
    auth: {
      registrationEnabled: env.REGISTRATION_ENABLED,
      emailVerificationRequired: env.EMAIL_VERIFICATION_REQUIRED,
      maxFailedLoginAttempts: env.LOGIN_MAX_FAILED_ATTEMPTS,
      lockoutSeconds: env.LOGIN_LOCKOUT_SECONDS,
      passwordResetTokenTtlSeconds: env.PASSWORD_RESET_TOKEN_TTL,
      emailVerificationTokenTtlSeconds: env.EMAIL_VERIFICATION_TOKEN_TTL,
      permissionCacheTtlSeconds: env.PERMISSION_CACHE_TTL,
    },
    rateLimit: {
      ttlSeconds: env.RATE_LIMIT_TTL_SECONDS,
      limit: env.RATE_LIMIT_LIMIT,
      authLimit: env.AUTH_RATE_LIMIT_LIMIT,
    },
    mail: {
      from: env.MAIL_FROM,
      transport: env.MAIL_TRANSPORT,
      smtpUrl: env.SMTP_URL,
      fileDir: env.MAIL_FILE_DIR,
      appPublicUrl: env.APP_PUBLIC_URL.replace(/\/+$/, ''),
      outboxPollIntervalMs: env.OUTBOX_POLL_INTERVAL_MS,
    },
  };
}
