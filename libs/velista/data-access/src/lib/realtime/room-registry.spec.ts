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

  /**
   * Plan 0017. The presence half of the registry, and the ordering rule that governs
   * it: an intent is only ever proposed for a list the connection is already in,
   * because the server refuses one from a socket that is not in the room.
   */
  describe('presence', () => {
    /** Accept whatever presence plan is outstanding, as a healthy server would. */
    function settlePresence(): void {
      const plan = registry.reconcilePresence();
      for (const listId of plan.viewsToStart) {
        registry.onViewStarted(listId);
      }
      for (const listId of plan.viewsToStop) {
        registry.onViewStopped(listId);
      }
      for (const ask of plan.editsToStart) {
        registry.onEditStarted(ask.listId, ask.lineId);
      }
      for (const listId of plan.editsToStop) {
        registry.onEditStopped(listId);
      }
    }

    /** Accept the zone half of an outstanding presence plan. */
    function settleZonePresence(): void {
      const plan = registry.reconcilePresence();
      for (const zoneId of plan.zonesToEnter) {
        registry.onZonePresenceStarted(zoneId);
      }
      for (const zoneId of plan.zonesToLeave) {
        registry.onZonePresenceStopped(zoneId);
      }
    }

    describe('zones (plan 0023)', () => {
      it('announces nothing for a plain zone subscription', () => {
        // The defect this split exists for: every group the caller belongs to is
        // subscribed for the whole session, so a subscription that announced would
        // put one person in all of their groups at once and never take them out.
        registry.acquireZone('z1', false);
        settle(registry);

        expect(registry.reconcilePresence().zonesToEnter).toEqual([]);
      });

      it('takes the zone room with the intent, and gives both back together', () => {
        const release = registry.acquireZonePresence('z1', false);

        expect(settle(registry).zonesToSubscribe).toEqual([
          { zoneId: 'z1', staff: false },
        ]);
        expect(registry.reconcilePresence().zonesToEnter).toEqual(['z1']);

        release();
        expect(registry.reconcile().zonesToUnsubscribe).toEqual(['z1']);
      });

      it('proposes nothing until the room it depends on is joined', () => {
        registry.acquireZonePresence('z1', false);

        expect(registry.reconcile().zonesToSubscribe).toHaveLength(1);
        expect(registry.reconcilePresence().zonesToEnter).toEqual([]);

        registry.onZoneSubscribed('z1', false);
        expect(registry.reconcilePresence().zonesToEnter).toEqual(['z1']);
      });

      it('leaves the group when the screen goes, keeping the subscription', () => {
        // Navigation, exactly: the dashboard holds the room for its live counts and
        // the group page held the intent. Only the intent goes.
        registry.acquireZone('z1', false);
        const page = registry.acquireZonePresence('z1', false);
        settle(registry);
        settleZonePresence();

        page();
        expect(registry.reconcile().zonesToUnsubscribe).toEqual([]);
        expect(registry.reconcilePresence().zonesToLeave).toEqual(['z1']);
      });

      it('says nothing about presence when the room itself is going', () => {
        // `zone.unsubscribe` drops this socket from zone presence on the server, so a
        // leave beside it buys another ack for what the unsubscribe already did.
        const release = registry.acquireZonePresence('z1', false);
        settle(registry);
        settleZonePresence();

        release();
        expect(registry.reconcile().zonesToUnsubscribe).toEqual(['z1']);
        expect(registry.reconcilePresence().zonesToLeave).toEqual([]);
      });

      it('does not re-ask a refused intent, and asks again once re-subscribed', () => {
        registry.acquireZonePresence('z1', false);
        settle(registry);
        registry.onZonePresenceRefused('z1');

        expect(registry.reconcilePresence().zonesToEnter).toEqual([]);

        registry.onZoneSubscribed('z1', false);
        expect(registry.reconcilePresence().zonesToEnter).toEqual(['z1']);
      });

      it('announces again on the next connection, presence being per connection', () => {
        registry.acquireZonePresence('z1', false);
        settle(registry);
        settleZonePresence();

        registry.onDisconnected();
        registry.onConnected();
        settle(registry);

        expect(registry.reconcilePresence().zonesToEnter).toEqual(['z1']);
      });
    });

    it('takes the list room with the view, and gives both back together', () => {
      const release = registry.acquireListView('l1');

      expect(settle(registry).listsToSubscribe).toEqual(['l1']);
      expect(registry.reconcilePresence().viewsToStart).toEqual(['l1']);

      release();
      expect(registry.reconcile().listsToUnsubscribe).toEqual(['l1']);
    });

    it('proposes no view until the room it depends on is joined', () => {
      registry.acquireListView('l1');

      // The subscribe has been asked for and not answered, so the view is not
      // sendable yet: this is the ordering the transport's two phases exist for.
      expect(registry.reconcile().listsToSubscribe).toEqual(['l1']);
      expect(registry.reconcilePresence().viewsToStart).toEqual([]);

      registry.onListSubscribed('l1');
      expect(registry.reconcilePresence().viewsToStart).toEqual(['l1']);
    });

    it('keeps one room and one view for a viewer beside a plain subscriber', () => {
      registry.acquireList('l1');
      const viewer = registry.acquireListView('l1');
      settle(registry);
      settlePresence();

      // The viewer leaves; the observer stays. The room is kept and the view stops.
      viewer();
      const plan = registry.reconcile();
      expect(plan.listsToUnsubscribe).toEqual([]);
      expect(registry.reconcilePresence().viewsToStop).toEqual(['l1']);
    });

    it('says nothing about presence when the room itself is going', () => {
      // `list.unsubscribe` removes this socket's viewer and editor entries on the
      // server, so an unview or a stop edit beside it buys two acks for nothing.
      const release = registry.acquireListView('l1');
      settle(registry);
      settlePresence();
      registry.setEditingLine('l1', 'line-1');
      settlePresence();

      release();
      expect(registry.reconcile().listsToUnsubscribe).toEqual(['l1']);

      const presence = registry.reconcilePresence();
      expect(presence.viewsToStop).toEqual([]);
      expect(presence.editsToStop).toEqual([]);
    });

    it('moves an edit to another line with no stop in between', () => {
      registry.acquireListView('l1');
      settle(registry);
      settlePresence();

      registry.setEditingLine('l1', 'line-1');
      expect(registry.reconcilePresence().editsToStart).toEqual([
        { listId: 'l1', lineId: 'line-1' },
      ]);
      registry.onEditStarted('l1', 'line-1');

      registry.setEditingLine('l1', 'line-2');
      const plan = registry.reconcilePresence();
      expect(plan.editsToStart).toEqual([{ listId: 'l1', lineId: 'line-2' }]);
      expect(plan.editsToStop).toEqual([]);
    });

    it('stops editing when the last viewer of the list leaves', () => {
      const release = registry.acquireListView('l1');
      registry.acquireList('l1');
      settle(registry);
      settlePresence();
      registry.setEditingLine('l1', 'line-1');
      settlePresence();

      release();
      expect(registry.reconcilePresence().editsToStop).toEqual(['l1']);
    });

    it('ignores an edit on a list nothing holds', () => {
      registry.setEditingLine('l1', 'line-1');

      expect(registry.reconcilePresence().editsToStart).toEqual([]);
    });

    it('keeps the joined entry when a stop fails, so the stop is retried', () => {
      // The server still believes this client is editing. Forgetting locally is how
      // the two ends stop agreeing, and nobody would ever say so again.
      registry.acquireListView('l1');
      settle(registry);
      settlePresence();
      registry.setEditingLine('l1', 'line-1');
      settlePresence();

      registry.setEditingLine('l1', null);
      expect(registry.reconcilePresence().editsToStop).toEqual(['l1']);
      registry.onPresenceAskFailed('l1');

      expect(registry.reconcilePresence().editsToStop).toEqual(['l1']);
    });

    it('does not re-ask a refused view on the same connection', () => {
      registry.acquireListView('l1');
      settle(registry);

      registry.onViewRefused('l1');
      expect(registry.reconcilePresence().viewsToStart).toEqual([]);
    });

    it('asks again once the room is subscribed afresh', () => {
      registry.acquireListView('l1');
      settle(registry);
      registry.onViewRefused('l1');

      // The one event that can change the server's answer about a room we believe we
      // are in is being put in it again.
      registry.onListSubscribed('l1');
      expect(registry.reconcilePresence().viewsToStart).toEqual(['l1']);
    });

    it('announces everything again on the next connection', () => {
      registry.acquireListView('l1');
      settle(registry);
      settlePresence();
      registry.setEditingLine('l1', 'line-1');
      settlePresence();

      registry.onDisconnected();

      // Present nowhere, in no room, whatever the refcounts say. Rooms first.
      expect(registry.reconcilePresence().viewsToStart).toEqual([]);
      settle(registry);

      const plan = registry.reconcilePresence();
      expect(plan.viewsToStart).toEqual(['l1']);
      expect(plan.editsToStart).toEqual([{ listId: 'l1', lineId: 'line-1' }]);
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
