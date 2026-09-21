import type { EntityManager } from 'typeorm';
import type { ListLine } from '../../entities';
import type {
  LineChangeActor,
  LineChangeRecorder,
  LineSnapshot,
  ListRef,
} from './line-change.recorder';

/**
 * A recorder that remembers what it was asked to write (plan 0138).
 *
 * Every write to a list line records a change now, so every unit spec of
 * `LineService` needs one. The real recorder inserts through the manager it is
 * handed, and a spec with a stand in manager has no `insert` to give it; this
 * keeps those specs about the rule they were written for and still lets one assert
 * that a site recorded, or that a settle recorded nothing.
 *
 * **What the rows actually look like is proven against Postgres**, which is where
 * the plan puts it (section 13, test 1): a column pair that stayed null and a
 * `createdAt` two rows share are facts about a database and not about a spy.
 */
export function fakeLineChanges(): {
  recorder: LineChangeRecorder;
  recorded: RecordedChange[];
} {
  const recorded: RecordedChange[] = [];
  const recorder = {
    added: async (
      _manager: EntityManager,
      list: ListRef,
      line: Pick<ListLine, 'id' | 'content' | 'quantity' | 'approvalStatus'>,
      actor: LineChangeActor
    ) => {
      recorded.push({ kind: 'added', list, lineId: line.id, actor });
    },
    edited: async (
      _manager: EntityManager,
      list: ListRef,
      lineId: string,
      before: LineSnapshot,
      after: LineSnapshot,
      actor: LineChangeActor
    ) => {
      recorded.push({ kind: 'edited', list, lineId, before, after, actor });
    },
    merged: async (
      _manager: EntityManager,
      list: ListRef,
      absorbed: LineSnapshot & { id: string },
      survivor: Pick<ListLine, 'id'>,
      actor: LineChangeActor
    ) => {
      recorded.push({
        kind: 'merged',
        list,
        lineId: absorbed.id,
        mergedIntoLineId: survivor.id,
        actor,
      });
    },
    deleted: async (
      _manager: EntityManager,
      list: ListRef,
      line: Pick<ListLine, 'id'>,
      actor: LineChangeActor
    ) => {
      recorded.push({ kind: 'deleted', list, lineId: line.id, actor });
    },
  } as unknown as LineChangeRecorder;
  return { recorder, recorded };
}

/** One call the fake recorder took. */
export interface RecordedChange {
  kind: 'added' | 'edited' | 'merged' | 'deleted';
  list: ListRef;
  lineId: string;
  mergedIntoLineId?: string;
  before?: LineSnapshot;
  after?: LineSnapshot;
  actor: LineChangeActor;
}
