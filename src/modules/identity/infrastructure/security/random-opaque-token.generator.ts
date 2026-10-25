import { createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { OpaqueTokenGenerator, type OpaqueToken } from '../../application/ports.js';

/**
 * 256-bit random tokens. A plain SHA-256 digest is sufficient for storage
 * because the input has full entropy, unlike passwords.
 */
@Injectable()
export class RandomOpaqueTokenGenerator extends OpaqueTokenGenerator {
  generate(): OpaqueToken {
    const token = randomBytes(32).toString('base64url');
    return { token, hash: this.hash(token) };
  }

  hash(token: string): string {
    return createHash('sha256').update(token, 'utf8').digest('hex');
  }
}
