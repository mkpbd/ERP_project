import { pbkdf2Sync, randomBytes } from 'node:crypto';

/** An ASP.NET Core Identity password hash (base64), made as the old system made them: v3 (PBKDF2 with a header) or v2. */
export function aspNetIdentityHash(
  password: string,
  format: 'v3-sha256' | 'v3-sha512' | 'v2' = 'v3-sha256',
  iterations = 10_000,
): string {
  const salt = randomBytes(16);
  if (format === 'v2') {
    return Buffer.concat([Buffer.from([0x00]), salt, pbkdf2Sync(password, salt, 1000, 32, 'sha1')]).toString('base64');
  }
  const prf = format === 'v3-sha256' ? 1 : 2;
  const header = Buffer.alloc(13);
  header[0] = 0x01;
  header.writeUInt32BE(prf, 1);
  header.writeUInt32BE(iterations, 5);
  header.writeUInt32BE(salt.length, 9);
  const subkey = pbkdf2Sync(password, salt, iterations, 32, format === 'v3-sha256' ? 'sha256' : 'sha512');
  return Buffer.concat([header, salt, subkey]).toString('base64');
}
