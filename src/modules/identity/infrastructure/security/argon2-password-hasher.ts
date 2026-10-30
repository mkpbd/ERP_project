import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import argon2 from 'argon2';
import { PasswordHasher } from '../../application/ports.js';
import { ASPNET_IDENTITY_PREFIX, verifyAspNetIdentityHash } from './aspnet-identity-hash.js';

/** OWASP Password Storage Cheat Sheet baseline for argon2id (19 MiB, t=2, p=1). */
const OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

@Injectable()
export class Argon2PasswordHasher extends PasswordHasher {
  private dummyHash: Promise<string> | null = null;

  hash(plain: string): Promise<string> {
    return argon2.hash(plain, OPTIONS);
  }

  async verify(hash: string, plain: string): Promise<boolean> {
    try {
      // Brought over from the old system: checked as it was made there, then rehashed at sign-in.
      if (hash.startsWith(ASPNET_IDENTITY_PREFIX)) {
        return await verifyAspNetIdentityHash(hash.slice(ASPNET_IDENTITY_PREFIX.length), plain);
      }
      return await argon2.verify(hash, plain);
    } catch {
      // A malformed stored hash must never authenticate.
      return false;
    }
  }

  needsRehash(hash: string): boolean {
    if (hash.startsWith(ASPNET_IDENTITY_PREFIX)) return true;
    try {
      return argon2.needsRehash(hash, OPTIONS);
    } catch {
      return true;
    }
  }

  async simulateVerify(plain: string): Promise<void> {
    this.dummyHash ??= this.hash(randomBytes(32).toString('base64url'));
    await this.verify(await this.dummyHash, plain);
  }
}
