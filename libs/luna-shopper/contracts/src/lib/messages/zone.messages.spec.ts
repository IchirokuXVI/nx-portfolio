import { MembershipStatus, ZoneRole, ZoneStatus } from '../enums/zone.enums';
import { RealtimeEvent } from '../events/realtime.events';
import { MEMBERSHIP_PATTERNS, ZONE_PATTERNS } from './zone.messages';

describe('zone contracts', () => {
  it('pins the enum wire values', () => {
    expect(ZoneStatus.ACTIVE).toBe('ACTIVE');
    expect(ZoneStatus.MARKED_FOR_DELETION).toBe('MARKED_FOR_DELETION');
    expect(ZoneRole.OWNER).toBe('OWNER');
    expect(ZoneRole.ADMIN).toBe('ADMIN');
    expect(ZoneRole.MEMBER).toBe('MEMBER');
    expect(MembershipStatus.PENDING).toBe('PENDING');
    expect(MembershipStatus.BANNED).toBe('BANNED');
  });

  it('pins the message subjects', () => {
    expect(ZONE_PATTERNS.create).toBe('zone.create');
    expect(ZONE_PATTERNS.join).toBe('zone.join');
    expect(ZONE_PATTERNS.listMine).toBe('zone.listMine');
    expect(MEMBERSHIP_PATTERNS.approve).toBe('membership.approve');
    expect(MEMBERSHIP_PATTERNS.ban).toBe('membership.ban');
  });

  it('pins the realtime event subjects', () => {
    expect(RealtimeEvent.MemberJoined).toBe('member.joined');
    expect(RealtimeEvent.ZoneOwnershipChanged).toBe('zone.ownershipChanged');
  });
});
