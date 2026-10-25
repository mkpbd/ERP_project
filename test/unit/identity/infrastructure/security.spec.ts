import { SignJWT, UnsecuredJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import { loadConfig, type AppConfig } from '../../../../src/config/configuration.js';
import { Argon2PasswordHasher } from '../../../../src/modules/identity/infrastructure/security/argon2-password-hasher.js';
import { JwtAccessTokenService } from '../../../../src/modules/identity/infrastructure/security/jwt-access-token.service.js';
import { RandomOpaqueTokenGenerator } from '../../../../src/modules/identity/infrastructure/security/random-opaque-token.generator.js';
import { AuthenticationError } from '../../../../src/shared/domain/errors.js';

const SECRET_A = 'a'.repeat(16) + 'secret-key-alpha-1234567890';
const SECRET_B = 'b'.repeat(16) + 'secret-key-bravo-1234567890';
const USER = '11111111-1111-4111-8111-111111111111';
const SESSION = '22222222-2222-4222-8222-222222222222';

function config(keys: string, overrides: Record<string, string> = {}): AppConfig {
  return loadConfig({
    DATABASE_URL: 'postgres://localhost/db',
    JWT_ISSUER: 'issuer',
    JWT_AUDIENCE: 'audience',
    JWT_SIGNING_KEYS: keys,
    APP_PUBLIC_URL: 'http://localhost',
    MAIL_FROM: 'x@example.com',
    ...overrides,
  });
}

describe('JwtAccessTokenService', () => {
  it('round-trips claims and sets standard headers and claims', async () => {
    const service = new JwtAccessTokenService(config(`k1:${SECRET_A}`));
    const issued = await service.issue({ userId: USER, sessionId: SESSION });
    const [header, payload] = issued.token
      .split('.')
      .slice(0, 2)
      .map((part) => JSON.parse(Buffer.from(part, 'base64url').toString()));
    expect(header).toMatchObject({ alg: 'HS256', kid: 'k1', typ: 'at+jwt' });
    expect(payload).toMatchObject({ sub: USER, sid: SESSION, iss: 'issuer', aud: 'audience' });
    expect(payload.exp - payload.iat).toBe(900);
    expect(payload.jti).toEqual(expect.any(String));
    await expect(service.verify(issued.token)).resolves.toEqual({ userId: USER, sessionId: SESSION });
  });

  it('supports key rotation: tokens from an older key still verify', async () => {
    const old = new JwtAccessTokenService(config(`k1:${SECRET_A}`));
    const rotated = new JwtAccessTokenService(config(`k2:${SECRET_B},k1:${SECRET_A}`));
    const issuedWithOld = await old.issue({ userId: USER, sessionId: SESSION });
    await expect(rotated.verify(issuedWithOld.token)).resolves.toMatchObject({ userId: USER });
    const issuedWithNew = await rotated.issue({ userId: USER, sessionId: SESSION });
    expect(JSON.parse(Buffer.from(issuedWithNew.token.split('.')[0]!, 'base64url').toString()).kid).toBe('k2');
    // Once k2 is retired, its tokens stop verifying.
    await expect(old.verify(issuedWithNew.token)).rejects.toThrow(AuthenticationError);
  });

  it.each([
    ['wrong audience', { JWT_AUDIENCE: 'someone-else' }],
    ['wrong issuer', { JWT_ISSUER: 'someone-else' }],
  ])('rejects tokens with the %s', async (_label, overrides) => {
    const foreign = await new JwtAccessTokenService(config(`k1:${SECRET_A}`, overrides)).issue({
      userId: USER,
      sessionId: SESSION,
    });
    await expect(new JwtAccessTokenService(config(`k1:${SECRET_A}`)).verify(foreign.token)).rejects.toMatchObject({
      code: 'invalid_token',
    });
  });

  it('rejects expired tokens with a distinct code', async () => {
    const key = new TextEncoder().encode(SECRET_A);
    const expired = await new SignJWT({ sid: SESSION })
      .setProtectedHeader({ alg: 'HS256', kid: 'k1', typ: 'at+jwt' })
      .setSubject(USER)
      .setIssuer('issuer')
      .setAudience('audience')
      .setIssuedAt(Math.floor(Date.now() / 1000) - 3600)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
      .sign(key);
    await expect(new JwtAccessTokenService(config(`k1:${SECRET_A}`)).verify(expired)).rejects.toMatchObject({
      code: 'token_expired',
    });
  });

  it('rejects unsigned (alg=none), tampered and unknown-kid tokens', async () => {
    const service = new JwtAccessTokenService(config(`k1:${SECRET_A}`));
    const unsigned = new UnsecuredJWT({ sid: SESSION })
      .setSubject(USER)
      .setIssuer('issuer')
      .setAudience('audience')
      .setIssuedAt()
      .setExpirationTime('5m')
      .encode();
    await expect(service.verify(unsigned)).rejects.toThrow(AuthenticationError);

    const valid = (await service.issue({ userId: USER, sessionId: SESSION })).token;
    const [h, p, s] = valid.split('.');
    const forgedPayload = Buffer.from(
      JSON.stringify({ ...JSON.parse(Buffer.from(p!, 'base64url').toString()), sub: SESSION }),
    ).toString('base64url');
    await expect(service.verify(`${h}.${forgedPayload}.${s}`)).rejects.toThrow(AuthenticationError);

    const otherKid = await new JwtAccessTokenService(config(`k9:${SECRET_A}`)).issue({
      userId: USER,
      sessionId: SESSION,
    });
    await expect(service.verify(otherKid.token)).rejects.toThrow(AuthenticationError);
  });
});

describe('Argon2PasswordHasher', () => {
  const hasher = new Argon2PasswordHasher();

  it('hashes with argon2id and verifies', async () => {
    const hash = await hasher.hash('correct horse battery');
    expect(hash).toMatch(/^\$argon2id\$v=19\$/);
    expect(hash.split('$')[3]!.split(',').sort()).toEqual(['m=19456', 'p=1', 't=2']);
    expect(await hasher.verify(hash, 'correct horse battery')).toBe(true);
    expect(await hasher.verify(hash, 'wrong')).toBe(false);
    expect(hasher.needsRehash(hash)).toBe(false);
  });

  it('never authenticates against malformed hashes and flags weak ones for rehash', async () => {
    expect(await hasher.verify('not-a-hash', 'x')).toBe(false);
    expect(hasher.needsRehash('$argon2id$v=19$m=4096,t=1,p=1$c2FsdHNhbHQ$aGFzaGhhc2hoYXNo')).toBe(true);
    await expect(hasher.simulateVerify('anything')).resolves.toBeUndefined();
  });
});

describe('RandomOpaqueTokenGenerator', () => {
  it('creates 256-bit url-safe tokens and stores only a SHA-256 hex digest', () => {
    const generator = new RandomOpaqueTokenGenerator();
    const { token, hash } = generator.generate();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(generator.hash(token)).toBe(hash);
    expect(generator.generate().token).not.toBe(token);
  });
});
