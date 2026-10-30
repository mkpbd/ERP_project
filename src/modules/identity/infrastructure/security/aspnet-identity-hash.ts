import { pbkdf2, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const derive = promisify(pbkdf2);

/** Password hashes brought over from the old system (ASP.NET Core Identity) carry this prefix. */
export const ASPNET_IDENTITY_PREFIX = 'aspnet-identity$';

const PRFS: Record<number, string> = { 0: 'sha1', 1: 'sha256', 2: 'sha512' };

/**
 * Verifies a password against an ASP.NET Core Identity hash (base64): format v2 (0x00: PBKDF2-HMAC-SHA1, 1000
 * iterations, 16-byte salt, 32-byte subkey) or v3 (0x01: PRF, iteration count and salt length in the header, big
 * endian). Anything else never matches.
 */
export async function verifyAspNetIdentityHash(stored: string, password: string): Promise<boolean> {
  let bytes: Buffer;
  try {
    bytes = Buffer.from(stored, 'base64');
  } catch {
    return false;
  }
  if (bytes.length === 0) return false;
  let digest: string;
  let iterations: number;
  let salt: Buffer;
  let expected: Buffer;
  if (bytes[0] === 0x00 && bytes.length === 49) {
    digest = 'sha1';
    iterations = 1000;
    salt = bytes.subarray(1, 17);
    expected = bytes.subarray(17);
  } else if (bytes[0] === 0x01 && bytes.length >= 13) {
    const prf = PRFS[bytes.readUInt32BE(1)];
    iterations = bytes.readUInt32BE(5);
    const saltLength = bytes.readUInt32BE(9);
    if (!prf || iterations < 1 || iterations > 10_000_000 || saltLength < 8 || bytes.length < 13 + saltLength + 16) {
      return false;
    }
    digest = prf;
    salt = bytes.subarray(13, 13 + saltLength);
    expected = bytes.subarray(13 + saltLength);
  } else {
    return false;
  }
  const actual = await derive(password, salt, iterations, expected.length, digest);
  return timingSafeEqual(actual, expected);
}
