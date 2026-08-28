import { randomInt } from 'node:crypto';

/**
 * Human typeable join codes (plan 0006, section 8). Simple and short for now: an
 * eight character code from an unambiguous alphabet (no 0/O/1/I/L). Adequate for
 * a closed group of testers; the plan records the richer share-link scheme (higher
 * entropy, expiry, use policies, rate limits) as future work, not built here.
 */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;

export function generateJoinCode(): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += ALPHABET[randomInt(ALPHABET.length)];
  }
  return code;
}
