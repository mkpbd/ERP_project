import { describe, expect, it } from 'vitest';
import type { AppConfig } from '../../../src/config/configuration.js';
import { JwtAccessTokenService } from '../../../src/modules/identity/infrastructure/security/jwt-access-token.service.js';
import { channelFor, mask, normalizeMobile } from '../../../src/modules/portal/domain/otp.js';
import { HmacOtpHasher, JwtPortalTokens } from '../../../src/modules/portal/infrastructure/security/portal-security.js';

const config = {
  jwt: {
    signingKeys: [{ kid: 'k1', secret: 'a-very-long-secret-used-only-in-these-unit-tests-0123456789' }],
    issuer: 'erp',
    audience: 'erp-api',
    accessTokenTtlSeconds: 900,
  },
} as unknown as AppConfig;
const patientId = '11111111-1111-4111-8111-111111111111';
const sessionId = '22222222-2222-4222-8222-222222222222';

describe('one-time codes', () => {
  it('are six digits', () => {
    const hasher = new HmacOtpHasher(config);
    for (let i = 0; i < 20; i += 1) expect(hasher.newCode()).toMatch(/^\d{6}$/);
  });

  it('go to the patient’s own mobile or email only, however written', () => {
    const patient = { mobiles: ['01711000000', '01811000000'], email: 'Rahima@Example.com' };
    expect(normalizeMobile('+880 1711-000000')).toBe('01711000000');
    expect(channelFor('8801811000000', patient)).toEqual({ channel: 'sms', to: '01811000000' });
    expect(channelFor(' rahima@example.com ', patient)).toEqual({ channel: 'email', to: 'rahima@example.com' });
    expect(channelFor('01911000000', patient)).toBeNull();
    expect(channelFor('other@example.com', patient)).toBeNull();
  });

  it('show only enough of where they went', () => {
    expect(mask('01711000123')).toBe('017*****123');
    expect(mask('rahima@example.com')).toBe('r***@example.com');
  });

  it('are kept as keyed hashes, bound to their challenge', () => {
    const hasher = new HmacOtpHasher(config);
    const hash = hasher.hash('c1', '123456');
    expect(hash).not.toContain('123456');
    expect(hasher.matches('c1', '123456', hash)).toBe(true);
    expect(hasher.matches('c1', '123457', hash)).toBe(false);
    expect(hasher.matches('c2', '123456', hash)).toBe(false);
  });
});

describe('patient tokens', () => {
  it('are never taken for staff tokens, nor staff tokens for them', async () => {
    const portal = new JwtPortalTokens(config);
    const staff = new JwtAccessTokenService(config);
    const patientToken = await portal.issue({ patientId, sessionId }, new Date(Date.now() + 60_000));
    expect(await portal.verify(patientToken)).toEqual({ patientId, sessionId });
    await expect(staff.verify(patientToken)).rejects.toMatchObject({ code: 'invalid_token' });
    const staffToken = (await staff.issue({ userId: patientId, sessionId })).token;
    await expect(portal.verify(staffToken)).rejects.toMatchObject({ code: 'invalid_token' });
  });

  it('expire', async () => {
    const portal = new JwtPortalTokens(config);
    const old = await portal.issue({ patientId, sessionId }, new Date(Date.now() - 60_000));
    await expect(portal.verify(old)).rejects.toMatchObject({ code: 'token_expired' });
  });
});
