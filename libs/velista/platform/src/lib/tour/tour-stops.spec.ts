import type { MyZone } from '@portfolio/velista/models';
import { planTour, TOUR_STOPS, tourHoldingsOf } from './tour-stops';

function zone(
  id: string,
  lists: readonly string[],
  myStatus: MyZone['myStatus'] = 'APPROVED'
): MyZone {
  return {
    id,
    name: id,
    joinCode: 'HK7M2QPD',
    status: 'ACTIVE',
    ownerUserId: 'u1',
    myRole: 'OWNER',
    myStatus,
    counts: {
      memberCount: 1,
      listCount: lists.length,
      pendingRequestCount: null,
      firstPendingRequesterName: null,
    },
    lists: lists.map((listId) => ({ id: listId, name: listId })),
  } as MyZone;
}

describe('the tour stops (velista 0099, section 3)', () => {
  it('holds six stops, in the order the plan gives', () => {
    expect(TOUR_STOPS.map((stop) => stop.anchor)).toEqual([
      'nav',
      'groups',
      'group-lists',
      'basket-tab',
      'assistant',
      'list-composer',
    ]);
  });

  it('shows a new account four: no lists stop, no voice stop', () => {
    const plan = planTour({ hasGroup: false, firstList: null, voice: true });

    expect(plan.map((planned) => planned.stop.id)).toEqual([
      'nav',
      'groups',
      'basket',
      'assistant',
    ]);
  });

  it('shows all six once there is a list, and sends the voice stop to it', () => {
    const plan = planTour({
      hasGroup: true,
      firstList: { zoneId: 'z1', listId: 'l1' },
      voice: true,
    });

    expect(plan).toHaveLength(6);
    expect(plan.at(-1)?.route).toEqual(['zones', 'z1', 'lists', 'l1']);
  });

  it('leaves the voice stop out where there is no microphone (velista 0174)', () => {
    const plan = planTour({
      hasGroup: true,
      firstList: { zoneId: 'z1', listId: 'l1' },
      voice: false,
    });

    expect(plan).toHaveLength(5);
    expect(plan.map((planned) => planned.stop.id)).not.toContain('voice');
  });

  it('points nowhere inside a group that has no list', () => {
    const plan = planTour({ hasGroup: true, firstList: null, voice: true });

    expect(plan.map((planned) => planned.stop.id)).not.toContain('lists');
  });
});

describe('tourHoldingsOf', () => {
  it('holds nothing without a group', () => {
    expect(tourHoldingsOf([], true)).toEqual({
      hasGroup: false,
      firstList: null,
      voice: true,
    });
  });

  it('takes the first list of the first joined group that has one', () => {
    expect(
      tourHoldingsOf([zone('empty', []), zone('z2', ['l2', 'l3'])], true)
    ).toEqual({
      hasGroup: true,
      firstList: { zoneId: 'z2', listId: 'l2' },
      voice: true,
    });
  });

  it('carries whether the microphone is offered, as it was told', () => {
    expect(tourHoldingsOf([zone('z1', ['l1'])], false).voice).toBe(false);
    expect(tourHoldingsOf([zone('z1', ['l1'])], true).voice).toBe(true);
  });

  it('does not count a group the person has only asked to join', () => {
    expect(tourHoldingsOf([zone('asked', ['l1'], 'PENDING')], true)).toEqual({
      hasGroup: false,
      firstList: null,
      voice: true,
    });
  });
});
