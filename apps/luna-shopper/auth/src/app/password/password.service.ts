import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';

/**
 * Password hashing (plan 0005, section 4.2; plan 0003 confirmed argon2).
 *
 * argon2id with library defaults; a per hash salt is embedded in the encoded
 * output, so no salt column is needed. Verification is constant time.
 */
@Injectable()
export class PasswordService {
  hash(password: string): Promise<string> {
    return argon2.hash(password, { type: argon2.argon2id });
  }

  async verify(hash: string, password: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, password);
    } catch {
      // A malformed stored hash must read as "does not match", never throw.
      return false;
    }
  }
}
