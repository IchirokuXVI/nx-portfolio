import { readFileSync } from 'node:fs';

/**
 * Resolve a PEM key from either a file path or an inline value.
 *
 * Local dev points `_FILE` at secrets/jwt.pub (keys stay out of `.env`); the
 * cluster injects the key inline from a Secret. The file wins when set. Read
 * eagerly at config load so a missing/unreadable file fails the boot fast.
 */
export function readKey(inline?: string, file?: string): string {
  if (file && file.trim()) {
    return readFileSync(file.trim(), 'utf8');
  }
  return inline as string;
}
