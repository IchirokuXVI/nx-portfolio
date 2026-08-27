import type { RoomReconciliation } from './room-registry';
import { RoomRegistry } from './room-registry';

/**
 * Reconcile and accept the whole plan, as a healthy server would, then return it.
 *
 * One call, because `reconcile` marks what it returned as outstanding: reconciling to
 * look at the plan and reconciling again to settle it would settle an empty second
 * plan and leave the first one in flight forever.
 */
function settle(registry: RoomRegistry): RoomReconciliation {
  const plan = registry.reconcile();
  for (const ask of plan.zonesToSubscribe) {
    registry.onZoneSubscribed(ask.zoneId, ask.staff);
  }
  for (const listId of plan.listsToSubscribe) {
    registry.onListSubscribed(listId);
  }
  return plan;
}

/** Every zone id a reconcile asked to subscribe, with its staff intent. */
function asks(registry: RoomRegistry): readonly [string, boolean][] {
  return registry
    .reconcile()
    .zonesToSubscribe.map(
      (ask) => [ask.zoneId, ask.staff] as [string, boolean]
    );
}

describe('RoomRegistry', () => {
  let registry: RoomRegistry;

  beforeEach(() => {
    registry = new RoomRegistry();
  });

  describe('refcounting', () => {
    it('subscribes once for two holders and unsubscribes on the second release', () => {
      const first = registry.acquireZone('z1', false);
      const second = registry.acquireZone('z1', false);

      expect(settle(registry).zonesToSubscribe).toEqual([
        { zoneId: 'z1', staff: false },
      ]);

      first();
      expect(registry.reconcile().zonesToUnsubscribe).toEqual([]);

      second();
      expect(registry.reconcile().zonesToUnsubscribe).toEqual(['z1']);
    });

    it('ignores a release called twice', () => {
      // A component releasing in both an effect cleanup and on destroy is one line of
      // ordinary code, and the second call must not evict the other holder.
      const first = registry.acquireZone('z1', false);
      registry.acquireZone('z1', false);
      settle(registry);

      first();
      first();

      expect(registry.reconcile().zonesToUnsubscribe).toEqual([]);
    });

    it('refcounts lists the same way', () => {
      const first = registry.acquireList('l1');
      const second = registry.acquireList('l1');

      expect(settle(registry).listsToSubscribe).toEqual(['l1']);

      first();
      expect(registry.reconcile().listsToUnsubscribe).toEqual([]);
      second();
      expect(registry.reconcile().listsToUnsubscribe).toEqual(['l1']);
    });
  });

  describe('the staff intent', () => {
    it('is the OR of the live holders', () => {
      registry.acquireZone('z1', false);
      const staff = registry.acquireZone('z1', true);

      // One refcount for the zone, asked for with staff because one holder wants it.
      expect(settle(registry).zonesToSubscribe).toEqual([
        { zoneId: 'z1', staff: true },
      ]);

      // And nothing more to say while that holder is alive.
      expect(asks(registry)).toEqual([]);
      expect(staff).toBeDefined();
    });

    it('re-subscribes without unsubscribing when the last staff holder leaves', () => {
      // R-S3. `zone.subscribe` is idempotent for the plain room and re-runs the staff
      // check, so a bare re-subscribe is the demotion. Leaving first would open a
      // window in which the caller receives nothing at all.
      registry.acquireZone('z1', false);
      const staff = registry.acquireZone('z1', true);
      settle(registry);

      staff();

      const plan = registry.reconcile();
      expect(plan.zonesToSubscribe).toEqual([{ zoneId: 'z1', staff: false }]);
      expect(plan.zonesToUnsubscribe).toEqual([]);
    });

    it('re-subscribes without unsubscribing when a staff holder arrives', () => {
      registry.acquireZone('z1', false);
      settle(registry);

      registry.acquireZone('z1', true);

      const plan = registry.reconcile();
      expect(plan.zonesToSubscribe).toEqual([{ zoneId: 'z1', staff: true }]);
      expect(plan.zonesToUnsubscribe).toEqual([]);
    });
  });

  describe('asks in flight', () => {
    it('does not ask twice while the first answer is outstanding', () => {
      registry.acquireZone('z1', false);

      expect(asks(registry)).toEqual([['z1', false]]);
      expect(asks(registry)).toEqual([]);
    });

    it('asks again after a failed ask, and does not treat it as a refusal', () => {
      // R7. A timeout means core was slow, not that the caller was declined, and a
      // permanent "not live" badge on a slow group is the false version of the exact
      // signal that badge gives.
      registry.acquireZone('z1', false);
      registry.reconcile();

      registry.onZoneAskFailed('z1');

      expect(registry.refusedZones().has('z1')).toBe(false);
      expect(asks(registry)).toEqual([['z1', false]]);
    });
  });

  describe('refusals', () => {
    it('latches and is not asked again on the same connection', () => {
      registry.acquireZone('z1', false);
      registry.reconcile();

      registry.onZoneRefused('z1');

      expect(registry.refusedZones().has('z1')).toBe(true);
      expect(asks(registry)).toEqual([]);
    });

    it('clears on the next connection, because authorization can change', () => {
      registry.acquireZone('z1', false);
      registry.reconcile();
      registry.onZoneRefused('z1');

      registry.onConnected();

      expect(registry.refusedZones().size).toBe(0);
      expect(asks(registry)).toEqual([['z1', false]]);
    });

    it('goes away with the last holder', () => {
      // A refusal is only meaningful about a zone somebody is asking for. Keeping it
      // would report a group nobody subscribes to as stale forever.
      const release = registry.acquireZone('z1', false);
      registry.reconcile();
      registry.onZoneRefused('z1');

      release();

      expect(registry.refusedZones().size).toBe(0);
    });
  });

  describe('reconnecting', () => {
    it('asks for everything again, because rooms are per connection', () => {
      // R6. The server has this client in no rooms at all on a new socket, however
      // confident the refcounts are.
      registry.acquireZone('z1', true);
      registry.acquireZone('z2', false);
      registry.acquireList('l1');
      settle(registry);
      expect(asks(registry)).toEqual([]);

      registry.onConnected();

      const plan = registry.reconcile();
      expect(plan.zonesToSubscribe).toEqual([
        { zoneId: 'z1', staff: true },
        { zoneId: 'z2', staff: false },
      ]);
      expect(plan.listsToSubscribe).toEqual(['l1']);
      expect(plan.zonesToUnsubscribe).toEqual([]);
    });

    it('does not ask to leave rooms the dropped connection was in', () => {
      // Nothing to leave: the socket that held them is gone. Emitting an unsubscribe
      // on the new one would be a message about somebody else's rooms.
      registry.acquireZone('z1', false);
      settle(registry);
      const release = registry.acquireZone('z2', false);
      settle(registry);
      release();

      registry.onDisconnected();

      expect(registry.reconcile().zonesToUnsubscribe).toEqual([]);
    });

    it('drops an outstanding ask, so the new connection asks again', () => {
      registry.acquireZone('z1', false);
      registry.reconcile();

      registry.onConnected();

      expect(asks(registry)).toEqual([['z1', false]]);
    });
  });

  describe('clear', () => {
    it('drops the desire as well, which is what signing out means', () => {
      registry.acquireZone('z1', true);
      registry.acquireList('l1');
      settle(registry);

      registry.clear();

      const plan = registry.reconcile();
      expect(plan.zonesToSubscribe).toEqual([]);
      expect(plan.listsToSubscribe).toEqual([]);
      expect(plan.zonesToUnsubscribe).toEqual([]);
    });
  });

  describe('roomNames', () => {
    it('builds the names the server builds, from the desired state', () => {
      registry.acquireZone('z1', true);
      registry.acquireZone('z2', false);
      registry.acquireList('l1');

      expect([...registry.roomNames()].sort()).toEqual([
        'list:l1',
        'zone:z1',
        'zone:z1:staff',
        'zone:z2',
      ]);
    });

    it('drops the staff room when the last staff holder goes', () => {
      registry.acquireZone('z1', false);
      const staff = registry.acquireZone('z1', true);

      staff();

      expect([...registry.roomNames()]).toEqual(['zone:z1']);
    });
  });
});
