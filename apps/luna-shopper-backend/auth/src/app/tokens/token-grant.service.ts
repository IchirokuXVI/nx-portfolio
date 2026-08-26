import { Injectable } from '@nestjs/common';
import { ValidationException } from '@portfolio/luna-shopper/platform';
import { createHash, randomBytes } from 'node:crypto';
import type {
  DeepPartial,
  EntityManager,
  EntityTarget,
  FindOptionsWhere,
  ObjectLiteral,
} from 'typeorm';

/**
 * The shape every single use grant table shares: the hash of a token nobody can
 * read back, when it stops working, and whether it has been spent.
 */
export interface TokenGrant {
  tokenHash: string;
  expiresAt: Date;
  consumedAt: Date | null;
}

/**
 * Issuing and consuming hashed single use tokens (plan 0021, section 3).
 *
 * Email confirmation owned this dance inline; password resets (0022) and OAuth
 * states (0023) need the identical one, so it lives here once. It is generic over
 * the entity rather than tied to a table, because the three grants share this
 * shape and none of them should share storage: a reset row and a confirmation row
 * expire on different clocks, and a leak of one must not be a leak of the other.
 *
 * The raw value is returned exactly once, at issue. Only its SHA-256 hash is
 * stored, so a database read never yields a usable link.
 */
@Injectable()
export class TokenGrantService {
  /** The stored form of a raw token. A lookup hashes the candidate and matches on it. */
  hash(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
  }

  /**
   * Mint a grant and return the raw token to send. 32 random bytes is well past
   * what a guess could reach, which is why a live grant can safely be superseded
   * by another rather than invalidated (section 4.5).
   */
  async issue<T extends TokenGrant & ObjectLiteral>(
    manager: EntityManager,
    entity: EntityTarget<T>,
    payload: DeepPartial<T>,
    ttlMs: number
  ): Promise<string> {
    const raw = randomBytes(32).toString('base64url');
    const repository = manager.getRepository(entity);
    await repository.save(
      repository.create({
        ...payload,
        tokenHash: this.hash(raw),
        expiresAt: new Date(Date.now() + ttlMs),
      } as DeepPartial<T>)
    );
    return raw;
  }

  /**
   * Spend a grant, or refuse. Missing, already spent and expired are deliberately
   * one outcome: telling them apart would tell a caller which of their guesses
   * was once a real token.
   */
  async consume<T extends TokenGrant & ObjectLiteral>(
    manager: EntityManager,
    entity: EntityTarget<T>,
    raw: string,
    invalidMessage = 'Invalid or expired token'
  ): Promise<T> {
    const repository = manager.getRepository(entity);
    const record = await repository.findOne({
      where: { tokenHash: this.hash(raw) } as FindOptionsWhere<T>,
    });
    if (
      !record ||
      record.consumedAt ||
      record.expiresAt.getTime() <= Date.now()
    ) {
      throw new ValidationException(invalidMessage);
    }
    record.consumedAt = new Date();
    await repository.save(record as DeepPartial<T>);
    return record;
  }
}
