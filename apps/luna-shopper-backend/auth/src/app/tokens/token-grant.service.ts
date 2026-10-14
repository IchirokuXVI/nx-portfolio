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
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';

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
    return (await this.issueRecord(manager, entity, payload, ttlMs)).raw;
  }

  /**
   * The same mint, and the row it wrote (plan 0077, section 8).
   *
   * {@link issue} answers with the raw token alone because that is all any caller
   * wanted until an operator action had to be recorded in an audit trail, and a
   * trail names the row it describes by id. The row comes back rather than being
   * looked up afterwards, so the caller records what was saved instead of what a
   * second query found.
   *
   * The raw token is still returned exactly once and still stored only as a hash,
   * and the audit trail drops `tokenHash` on the way in, so recording the grant
   * does not turn a single use link into a durable one.
   */
  async issueRecord<T extends TokenGrant & ObjectLiteral>(
    manager: EntityManager,
    entity: EntityTarget<T>,
    payload: DeepPartial<T>,
    ttlMs: number
  ): Promise<{ raw: string; record: T }> {
    const raw = randomBytes(32).toString('base64url');
    const repository = manager.getRepository(entity);
    const record = await repository.save(
      repository.create({
        ...payload,
        tokenHash: this.hash(raw),
        expiresAt: new Date(Date.now() + ttlMs),
      } as DeepPartial<T>)
    );
    return { raw, record };
  }

  /**
   * Spend a grant, or refuse. Missing, already spent and expired are deliberately
   * one outcome: telling them apart would tell a caller which of their guesses
   * was once a real token.
   *
   * `set` is written in the same statement as `consumedAt`, so a column that
   * says how the grant ended (`password_resets.spentAs`, plan 0210) can never
   * disagree with the column that says it ended.
   */
  async consume<T extends TokenGrant & ObjectLiteral>(
    manager: EntityManager,
    entity: EntityTarget<T>,
    raw: string,
    invalidMessage = 'Invalid or expired token',
    set: Partial<T> = {}
  ): Promise<T> {
    const record = await this.spend(manager, entity, this.hash(raw), set);
    if (!record) {
      throw new ValidationException(invalidMessage);
    }
    return record;
  }

  /**
   * The one statement that spends a grant (plan 0210, target state 2), or null
   * when it spent nothing.
   *
   * **Conditional, so that a grant ends at most one time.** It used to read
   * the row and then save it, and two requests at the same instant both passed
   * the read: with a reset link and a sign in link on one grant, both won. Now
   * the condition is in the `WHERE` of the write, and Postgres takes the row
   * lock before it evaluates it, so the second statement waits for the first,
   * reads the row again, finds `consumedAt` set and updates nothing. The email
   * confirmation and the OAuth state share this method and the fix.
   *
   * Expiry is the clock of the database, the same clock that wrote
   * `consumedAt`, so a grant cannot read as live on one clock and as spent on
   * another.
   *
   * **`RETURNING` answers raw rows, not entities.** The query builder hands
   * back `raw` with the column names of the table, so the row is mapped back
   * through the metadata of the entity. Every column of these tables is named
   * as its property, and the mapping still goes through `databaseName` so that
   * a future column with its own name maps right. The integration spec asserts
   * the mapping against a real Postgres.
   */
  async spend<T extends TokenGrant & ObjectLiteral>(
    manager: EntityManager,
    entity: EntityTarget<T>,
    tokenHash: string,
    set: Partial<T> = {}
  ): Promise<T | null> {
    const result = await manager
      .createQueryBuilder()
      .update(entity)
      .set({
        ...set,
        consumedAt: () => 'now()',
      } as QueryDeepPartialEntity<T>)
      .where(
        '"tokenHash" = :tokenHash AND "consumedAt" IS NULL AND "expiresAt" > now()',
        { tokenHash }
      )
      .returning('*')
      .execute();
    const row = (result.raw as Record<string, unknown>[] | undefined)?.[0];
    return row ? this.fromRow(manager, entity, row) : null;
  }

  /**
   * End every other live grant of the same account (plan 0210, target state
   * 3), in the transaction of the spend.
   *
   * Spending one grant is the person saying which link they meant. A first
   * mail they asked for and never used would otherwise stay a working key for
   * the rest of its hour, and with a sign in link on it that is a way into an
   * account just after the reset that was meant to close every way in.
   *
   * **Issuing ends nothing** (decision D5). Only a spend does. Otherwise anyone
   * who knows an address could kill a link an operator had just shared, by
   * asking for a reset of their own.
   *
   * Answers how many it ended, which only a spec reads.
   */
  async endOthers<
    T extends TokenGrant & { id: string; userId: string } & ObjectLiteral,
  >(
    manager: EntityManager,
    entity: EntityTarget<T>,
    spent: T,
    set: Partial<T> = {}
  ): Promise<number> {
    const result = await manager
      .createQueryBuilder()
      .update(entity)
      .set({
        ...set,
        consumedAt: () => 'now()',
      } as QueryDeepPartialEntity<T>)
      .where('"userId" = :userId AND "consumedAt" IS NULL AND "id" <> :id', {
        userId: spent.userId,
        id: spent.id,
      })
      .execute();
    return result.affected ?? 0;
  }

  /**
   * Read a grant by its token whatever its state: live, spent or expired.
   *
   * Never the way to spend one. A caller that needs to know whose grant it is
   * before it decides what to do (the sign in of plan 0210 does) reads it here
   * and then spends it with {@link spend}, whose condition is what makes the
   * decision safe against a second request at the same instant.
   */
  async find<T extends TokenGrant & ObjectLiteral>(
    manager: EntityManager,
    entity: EntityTarget<T>,
    raw: string
  ): Promise<T | null> {
    return manager.getRepository(entity).findOne({
      where: { tokenHash: this.hash(raw) } as FindOptionsWhere<T>,
    });
  }

  /** Whether a grant read with {@link find} could still be spent right now. */
  isLive(grant: TokenGrant): boolean {
    return !grant.consumedAt && grant.expiresAt.getTime() > Date.now();
  }

  /** An entity from a raw `RETURNING` row, by the column names of the table. */
  private fromRow<T extends ObjectLiteral>(
    manager: EntityManager,
    entity: EntityTarget<T>,
    row: Record<string, unknown>
  ): T {
    const metadata = manager.connection.getMetadata(entity);
    const fields: Record<string, unknown> = {};
    for (const column of metadata.columns) {
      if (column.databaseName in row) {
        fields[column.propertyName] = row[column.databaseName];
      }
    }
    return manager.getRepository(entity).create(fields as DeepPartial<T>);
  }
}
