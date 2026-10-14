import type {
  DeepPartial,
  EntityManager,
  EntityTarget,
  FindOptionsWhere,
  ObjectLiteral,
} from 'typeorm';
import { TokenGrantService, type TokenGrant } from './token-grant.service';

/**
 * A {@link TokenGrantService} for the service specs, which build their subject
 * by hand over repository doubles that understand `findOne`, `find` and `save`
 * and no SQL.
 *
 * The real {@link TokenGrantService.spend} is one conditional `UPDATE ...
 * RETURNING` (plan 0210), and a double that pretended to evaluate it would
 * prove only that it agrees with itself. So this one spends the way the
 * service did before: read, check, save. That is enough for a spec about what a
 * service does with a spent grant. What makes a spend safe against a second
 * request at the same instant is proven against a real Postgres, in
 * `token-grant.integration.spec.ts`, and nowhere else.
 */
export class InMemoryTokenGrantService extends TokenGrantService {
  override async spend<T extends TokenGrant & ObjectLiteral>(
    manager: EntityManager,
    entity: EntityTarget<T>,
    tokenHash: string,
    set: Partial<T> = {}
  ): Promise<T | null> {
    const repository = manager.getRepository(entity);
    const record = await repository.findOne({
      where: { tokenHash } as FindOptionsWhere<T>,
    });
    if (!record || !this.isLive(record)) {
      return null;
    }
    Object.assign(record, set, { consumedAt: new Date() });
    await repository.save(record as DeepPartial<T>);
    return record;
  }

  override async endOthers<
    T extends TokenGrant & { id: string; userId: string } & ObjectLiteral,
  >(
    manager: EntityManager,
    entity: EntityTarget<T>,
    spent: T,
    set: Partial<T> = {}
  ): Promise<number> {
    const repository = manager.getRepository(entity);
    const rows = await repository.find({
      where: { userId: spent.userId } as FindOptionsWhere<T>,
    });
    const live = rows.filter((row) => row.id !== spent.id && !row.consumedAt);
    for (const row of live) {
      Object.assign(row, set, { consumedAt: new Date() });
      await repository.save(row as DeepPartial<T>);
    }
    return live.length;
  }
}
