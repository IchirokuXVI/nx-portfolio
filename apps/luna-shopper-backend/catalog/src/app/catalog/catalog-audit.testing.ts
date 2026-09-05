import type { EntityTarget, ObjectLiteral, Repository } from 'typeorm';
import {
  type AuditedWrite,
  CatalogAuditService,
  diffFields,
} from './catalog-audit.service';
import type { CatalogActor } from './platform-admin.service';

/** One audit row, as a spec cares about it. */
export interface RecordedChange {
  actor: CatalogActor;
  action: 'CREATE' | 'UPDATE' | 'DELETE';
  entity: string;
  entityId: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}

/** What {@link fakeAudit} hands back: the double, and what it recorded. */
export interface FakeAudit {
  service: CatalogAuditService;
  recorded: RecordedChange[];
}

/**
 * A {@link CatalogAuditService} for the service specs, which construct their
 * subject by hand with fake repositories rather than through a Nest module.
 *
 * The real one opens a transaction and writes through its `EntityManager`. This
 * one routes every write straight back to the fake repository the spec already
 * built, so a spec that asserted on `supermarketItems.save` keeps asserting on
 * exactly that and says nothing new about the trail. What is genuinely
 * transactional is proven in `catalog-audit.integration.spec.ts` against a real
 * Postgres, because a fake cannot prove a rollback.
 *
 * The recording half is real: the same {@link diffFields} decides what moved, so
 * a spec can assert that a write recorded one row, or none.
 */
export function fakeAudit(
  bindings: Array<
    [
      EntityTarget<ObjectLiteral>,
      { name: string; repository: Partial<Repository<ObjectLiteral>> },
    ]
  >
): FakeAudit {
  const bound = new Map(bindings);
  const recorded: RecordedChange[] = [];

  function bindingFor(target: EntityTarget<ObjectLiteral>) {
    const found = bound.get(target);
    if (!found) {
      // Deliberately fatal rather than a silent no-op. A write that reached an
      // entity the spec did not bind is a write the spec is not looking at, and
      // returning something plausible would hide it.
      throw new Error(
        `fakeAudit: no repository bound for ${String(
          (target as { name?: string }).name ?? target
        )}`
      );
    }
    return found;
  }

  /** The columns a spec's plain fixture object carries. */
  function snapshot(row: ObjectLiteral): Record<string, unknown> {
    const fields: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      if (
        key === 'id' ||
        key === 'createdAt' ||
        key === 'updatedAt' ||
        key === 'priceObservedAt'
      ) {
        continue;
      }
      fields[key] = value instanceof Date ? value.toISOString() : value;
    }
    return fields;
  }

  const service = {
    write: async <T>(
      actor: CatalogActor,
      work: (tx: AuditedWrite) => Promise<T>
    ): Promise<T> => {
      const tx = {
        manager: {
          save: async (
            target: EntityTarget<ObjectLiteral>,
            row: ObjectLiteral | ObjectLiteral[],
            options?: unknown
          ) =>
            bindingFor(target).repository.save?.(
              row as never,
              options as never
            ),
          findOne: async (
            target: EntityTarget<ObjectLiteral>,
            options: unknown
          ) => bindingFor(target).repository.findOne?.(options as never),
          find: async (target: EntityTarget<ObjectLiteral>, options: unknown) =>
            bindingFor(target).repository.find?.(options as never) ?? [],
          // A caller that reads its own writes back inside the transaction
          // (plan 0084's scope derivation does) needs `create` here too, and
          // the bound repository's is the one the spec already asserts on.
          create: (target: EntityTarget<ObjectLiteral>, draft: ObjectLiteral) =>
            bindingFor(target).repository.create?.(draft as never) ?? draft,
          delete: async (
            target: EntityTarget<ObjectLiteral>,
            criteria: unknown
          ) => bindingFor(target).repository.delete?.(criteria as never),
        },
        create: async (
          target: EntityTarget<ObjectLiteral>,
          draft: ObjectLiteral
        ) => {
          const saved = await bindingFor(target).repository.save?.(
            draft as never
          );
          recorded.push({
            actor,
            action: 'CREATE',
            entity: bindingFor(target).name,
            entityId: (saved as ObjectLiteral)?.['id'],
            before: null,
            after: snapshot(saved as ObjectLiteral),
          });
          return saved;
        },
        update: async (
          target: EntityTarget<ObjectLiteral>,
          before: ObjectLiteral,
          row: ObjectLiteral
        ) => {
          const saved = await bindingFor(target).repository.save?.(
            row as never
          );
          const moved = diffFields(snapshot(before), snapshot(row));
          if (moved) {
            recorded.push({
              actor,
              action: 'UPDATE',
              entity: bindingFor(target).name,
              entityId: (saved as ObjectLiteral)?.['id'],
              ...moved,
            });
          }
          return saved;
        },
        delete: async (
          target: EntityTarget<ObjectLiteral>,
          row: ObjectLiteral
        ) => {
          await bindingFor(target).repository.delete?.({
            id: row['id'],
          } as never);
          recorded.push({
            actor,
            action: 'DELETE',
            entity: bindingFor(target).name,
            entityId: row['id'],
            before: snapshot(row),
            after: null,
          });
        },
        recordCreate: async (
          target: EntityTarget<ObjectLiteral>,
          row: ObjectLiteral
        ) => {
          recorded.push({
            actor,
            action: 'CREATE',
            entity: bindingFor(target).name,
            entityId: row['id'],
            before: null,
            after: snapshot(row),
          });
        },
        recordUpdate: async (
          target: EntityTarget<ObjectLiteral>,
          before: ObjectLiteral,
          row: ObjectLiteral
        ) => {
          const moved = diffFields(snapshot(before), snapshot(row));
          if (moved) {
            recorded.push({
              actor,
              action: 'UPDATE',
              entity: bindingFor(target).name,
              entityId: row['id'],
              ...moved,
            });
          }
        },
        snapshot: (_: EntityTarget<ObjectLiteral>, row: ObjectLiteral) =>
          snapshot(row),
      } as unknown as AuditedWrite;

      return work(tx);
    },
  } as unknown as CatalogAuditService;

  return { service, recorded };
}
