import { z } from 'zod';

const booleanString = z.enum(['true', 'false', '1', '0']).transform((value) => value === 'true' || value === '1');

const commaSeparated = z.string().transform((value) =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0),
);

const seconds = (defaultValue: number, min: number, max: number) =>
  z.coerce.number().int().min(min).max(max).default(defaultValue);

/**
 * JWT signing keys in the form `kid:secret,kid:secret`.
 * The first key signs new tokens; all keys verify, which allows rotation.
 */
const signingKeys = z
  .string()
  .min(1)
  .transform((value, ctx) => {
    const keys = value.split(',').map((entry) => {
      const separator = entry.indexOf(':');
      return separator > 0
        ? { kid: entry.slice(0, separator).trim(), secret: entry.slice(separator + 1).trim() }
        : { kid: '', secret: '' };
    });
    for (const key of keys) {
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(key.kid)) {
        ctx.addIssue({ code: 'custom', message: 'Each signing key needs a kid matching [A-Za-z0-9_-]{1,64}' });
        return z.NEVER;
      }
      if (key.secret.length < 32) {
        ctx.addIssue({ code: 'custom', message: `Signing key "${key.kid}" must be at least 32 characters` });
        return z.NEVER;
      }
    }
    if (new Set(keys.map((key) => key.kid)).size !== keys.length) {
      ctx.addIssue({ code: 'custom', message: 'Signing key ids must be unique' });
      return z.NEVER;
    }
    return keys;
  });

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    TRUST_PROXY: booleanString.default(false),

    DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\//, 'DATABASE_URL must be a postgres:// URL'),
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),

    JWT_ISSUER: z.string().min(1),
    JWT_AUDIENCE: z.string().min(1),
    JWT_SIGNING_KEYS: signingKeys,
    JWT_ACCESS_TOKEN_TTL: seconds(900, 60, 3600),
    JWT_REFRESH_TOKEN_TTL: seconds(2_592_000, 3600, 7_776_000),

    CORS_ORIGINS: commaSeparated.default([]),
    COOKIE_SECURE: booleanString.default(true),

    REGISTRATION_ENABLED: booleanString.default(true),
    EMAIL_VERIFICATION_REQUIRED: booleanString.default(true),
    LOGIN_MAX_FAILED_ATTEMPTS: z.coerce.number().int().min(1).max(100).default(5),
    LOGIN_LOCKOUT_SECONDS: seconds(900, 1, 86_400),
    PASSWORD_RESET_TOKEN_TTL: seconds(1800, 300, 86_400),
    EMAIL_VERIFICATION_TOKEN_TTL: seconds(86_400, 300, 604_800),
    PERMISSION_CACHE_TTL: seconds(30, 0, 600),

    RATE_LIMIT_TTL_SECONDS: seconds(60, 1, 3600),
    RATE_LIMIT_LIMIT: z.coerce.number().int().min(1).default(120),
    AUTH_RATE_LIMIT_LIMIT: z.coerce.number().int().min(1).default(10),

    APP_PUBLIC_URL: z.url(),
    MAIL_FROM: z.string().min(3),
    MAIL_TRANSPORT: z.enum(['smtp', 'file', 'memory']).default('file'),
    SMTP_URL: z
      .string()
      .regex(/^smtps?:\/\//, 'SMTP_URL must be smtp:// or smtps://')
      .optional(),
    MAIL_FILE_DIR: z.string().default('./var/mail'),
    OUTBOX_POLL_INTERVAL_MS: z.coerce.number().int().min(0).default(2000),

    SWAGGER_ENABLED: booleanString.default(true),

    REPORT_TIME_ZONE: z
      .string()
      .refine((zone) => {
        try {
          new Intl.DateTimeFormat('en', { timeZone: zone });
          return true;
        } catch {
          return false;
        }
      }, 'REPORT_TIME_ZONE must be an IANA time zone such as Asia/Dhaka')
      .default('Asia/Dhaka'),
    REPORT_RENDER_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(2),
    /** Leave unset to use the Chromium installed by `npx playwright install chromium-headless-shell`. */
    CHROMIUM_EXECUTABLE_PATH: z.string().min(1).optional(),
  })
  .superRefine((env, ctx) => {
    if (env.MAIL_TRANSPORT === 'smtp' && !env.SMTP_URL) {
      ctx.addIssue({ code: 'custom', path: ['SMTP_URL'], message: 'SMTP_URL is required when MAIL_TRANSPORT=smtp' });
    }
    if (env.NODE_ENV === 'production') {
      if (env.MAIL_TRANSPORT !== 'smtp') {
        ctx.addIssue({ code: 'custom', path: ['MAIL_TRANSPORT'], message: 'Production requires MAIL_TRANSPORT=smtp' });
      }
      if (!env.COOKIE_SECURE) {
        ctx.addIssue({ code: 'custom', path: ['COOKIE_SECURE'], message: 'Production requires COOKIE_SECURE=true' });
      }
    }
  });

export type Env = z.infer<typeof envSchema>;
