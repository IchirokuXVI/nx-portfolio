import { IDENTITY_EVENTS } from '../lib/events/identity.events';
import { RealtimeEvent } from '../lib/events/realtime.events';
import { AUTH_PATTERNS } from '../lib/messages/auth.messages';
import {
  ITEM_PATTERNS,
  SUPERMARKET_ITEM_PATTERNS,
  SUPERMARKET_LOCATION_PATTERNS,
  SUPERMARKET_PATTERNS,
} from '../lib/messages/catalog.messages';
import {
  COMMENT_PATTERNS,
  LINE_PATTERNS,
  LIST_PATTERNS,
} from '../lib/messages/list.messages';
import { MERGE_PATTERNS } from '../lib/messages/merge.messages';
import { REALTIME_ACCESS_PATTERNS } from '../lib/messages/realtime.messages';
import { RECONCILIATION_PATTERNS } from '../lib/messages/reconciliation.messages';
import {
  MEMBERSHIP_PATTERNS,
  ZONE_PATTERNS,
} from '../lib/messages/zone.messages';
import {
  createContractsAjv,
  eventContracts,
  messageContracts,
  validateEvent,
  validateMessageRequest,
  validateMessageResponse,
} from './index';
import { messageRequestSchemaId, messageResponseSchemaId } from './registry';

describe('contract schemas', () => {
  it('builds a single Ajv instance with every schema (all $ids unique, all $refs resolve)', () => {
    // This is the strongest guard: Ajv throws on a duplicate $id or an
    // unresolvable $ref, so a typo in any schema fails here immediately.
    expect(() => createContractsAjv()).not.toThrow();
  });

  describe('registry completeness', () => {
    const allMessageSubjects = [
      ...Object.values(AUTH_PATTERNS),
      ...Object.values(RECONCILIATION_PATTERNS),
      ...Object.values(ZONE_PATTERNS),
      ...Object.values(MEMBERSHIP_PATTERNS),
      ...Object.values(LIST_PATTERNS),
      ...Object.values(LINE_PATTERNS),
      ...Object.values(COMMENT_PATTERNS),
      ...Object.values(MERGE_PATTERNS),
      ...Object.values(REALTIME_ACCESS_PATTERNS),
      ...Object.values(SUPERMARKET_PATTERNS),
      ...Object.values(SUPERMARKET_LOCATION_PATTERNS),
      ...Object.values(ITEM_PATTERNS),
      ...Object.values(SUPERMARKET_ITEM_PATTERNS),
    ];

    it.each(allMessageSubjects)(
      'has a request + response schema for subject %s',
      (subject) => {
        expect(messageContracts[subject]).toBeDefined();
        const ajv = createContractsAjv();
        expect(ajv.getSchema(messageRequestSchemaId(subject))).toBeDefined();
        expect(ajv.getSchema(messageResponseSchemaId(subject))).toBeDefined();
      }
    );

    const allEventNames = [
      ...Object.values(IDENTITY_EVENTS),
      ...Object.values(RealtimeEvent),
    ];

    it.each(allEventNames)('has a payload schema for event %s', (event) => {
      expect(eventContracts[event]).toBeDefined();
    });
  });

  describe('representative valid payloads pass', () => {
    it('auth.register request + AuthTokens response', () => {
      expect(
        validateMessageRequest('auth.register', {
          email: 'a@b.com',
          password: 'pw',
        }).valid
      ).toBe(true);
      expect(
        validateMessageResponse('auth.register', {
          userId: 'u',
          kind: 'TEMPORARY',
          username: 'Swift Sail',
          accessToken: 'a',
          refreshToken: 'r',
        }).valid
      ).toBe(true);
    });

    it('AuthTokens requires the global username (plan 0018, section 9)', () => {
      expect(
        validateMessageResponse('auth.refresh', {
          userId: 'u',
          kind: 'REGISTERED',
          accessToken: 'a',
          refreshToken: 'r',
        }).valid
      ).toBe(false);
    });

    it('auth.setUsername request defaults propagation by omitting it', () => {
      expect(
        validateMessageRequest('auth.setUsername', {
          userId: 'u',
          username: 'Vela Rápida',
        }).valid
      ).toBe(true);
      expect(
        validateMessageRequest('auth.setUsername', {
          userId: 'u',
          username: 'Vela Rápida',
          propagation: 'ALL_ZONES',
        }).valid
      ).toBe(true);
      expect(
        validateMessageRequest('auth.setUsername', {
          userId: 'u',
          username: 'Vela',
          propagation: 'EVERYWHERE',
        }).valid
      ).toBe(false);
    });

    it('auth.getProfile response (UserProfileView, nullable email)', () => {
      expect(
        validateMessageResponse('auth.getProfile', {
          userId: 'u',
          kind: 'TEMPORARY',
          username: 'Quiet Lantern',
          email: null,
          emailVerified: false,
          displayName: null,
        }).valid
      ).toBe(true);
    });

    it('membership.setUsername request (plan 0018, section 5)', () => {
      expect(
        validateMessageRequest('membership.setUsername', {
          userId: 'u',
          zoneId: 'z',
          membershipId: 'm',
          username: 'Mamá',
        }).valid
      ).toBe(true);
    });

    it('user.usernameChanged event carries both names and the mode', () => {
      expect(
        validateEvent('user.usernameChanged', {
          eventId: 'e1',
          userId: 'u',
          oldUsername: 'Swift Sail',
          newUsername: 'Vela Rápida',
          propagation: 'MATCHING_ZONES',
        }).valid
      ).toBe(true);
      expect(
        validateEvent('user.usernameChanged', {
          eventId: 'e1',
          userId: 'u',
          newUsername: 'Vela',
          propagation: 'ALL_ZONES',
        }).valid
      ).toBe(false);
    });

    it('member.usernameChanged rides the domain event envelope', () => {
      expect(
        validateEvent('member.usernameChanged', {
          event: 'member.usernameChanged',
          eventId: 'e2',
          zoneId: 'z',
          payload: { id: 'm', username: 'Mamá' },
        }).valid
      ).toBe(true);
    });

    it('zone.create response (ownerUserId null, empty config)', () => {
      expect(
        validateMessageResponse('zone.create', {
          id: 'z',
          name: 'Home',
          joinCode: 'ABCD1234',
          status: 'ACTIVE',
          ownerUserId: null,
          config: {},
        }).valid
      ).toBe(true);
    });

    it('line.add response (both enum states, itemId null)', () => {
      expect(
        validateMessageResponse('line.add', {
          id: 'l',
          listId: 'li',
          content: 'Milk',
          quantity: 1,
          itemId: null,
          position: 1,
          approvalStatus: 'PENDING',
          status: 'PENDING',
          createdByUserId: 'u',
          approvedByUserId: null,
          version: 1,
        }).valid
      ).toBe(true);
    });

    it('merge.request response (PENDING, unresolved)', () => {
      expect(
        validateMessageResponse('merge.request', {
          id: 'm',
          zoneId: 'z',
          sourceUserId: 's',
          targetUserId: 't',
          requestedByUserId: 'r',
          status: 'PENDING',
          resolvedByUserId: null,
        }).valid
      ).toBe(true);
    });

    it('realtime.checkZoneAccess response', () => {
      expect(
        validateMessageResponse('realtime.checkZoneAccess', { allowed: true })
          .valid
      ).toBe(true);
    });

    it('line.added domain event envelope', () => {
      expect(
        validateEvent('line.added', {
          event: 'line.added',
          eventId: 'e1',
          zoneId: 'z',
          listId: 'l',
          payload: { id: 'l1' },
        }).valid
      ).toBe(true);
    });

    it('presence.listUpdated event (ListPresence)', () => {
      expect(
        validateEvent('presence.listUpdated', {
          listId: 'l',
          viewers: [],
          editors: [],
        }).valid
      ).toBe(true);
    });

    it('user.deleted event and auth.deleteAccount response (plan 0011)', () => {
      expect(validateEvent('user.deleted', { userId: 'u' }).valid).toBe(true);
      expect(
        validateMessageResponse('auth.deleteAccount', {
          userId: 'u',
          deleted: true,
        }).valid
      ).toBe(true);
    });

    it('line.add request may carry an optional itemId (plan 0012)', () => {
      expect(
        validateMessageRequest('line.add', {
          userId: 'u',
          listId: 'li',
          content: 'Milk',
          itemId: 'item-1',
        }).valid
      ).toBe(true);
    });

    it('catalog item.create request + item.search response (plan 0012)', () => {
      expect(
        validateMessageRequest('item.create', {
          userId: 'owner',
          name: { en: 'Milk', es: 'Leche' },
          category: 'DAIRY',
          defaultUnit: 'LITER',
        }).valid
      ).toBe(true);
      expect(
        validateMessageResponse('item.search', {
          items: [
            {
              id: 'i',
              name: { en: 'Milk', es: 'Leche' },
              brand: null,
              imageUrl: null,
              sku: null,
              category: 'DAIRY',
              defaultUnit: 'LITER',
            },
          ],
          nextCursor: null,
        }).valid
      ).toBe(true);
    });
  });

  describe('malformed payloads fail', () => {
    it('missing a required field', () => {
      expect(
        validateMessageRequest('auth.register', { email: 'a@b.com' }).valid
      ).toBe(false);
    });

    it('a bad enum value', () => {
      expect(
        validateMessageResponse('zone.create', {
          id: 'z',
          name: 'Home',
          joinCode: 'ABCD1234',
          status: 'FOO',
          ownerUserId: null,
          config: {},
        }).valid
      ).toBe(false);
    });

    it('a wrong scalar type', () => {
      expect(
        validateMessageRequest('zone.listMine', {
          userId: 'u',
          limit: '10',
        }).valid
      ).toBe(false);
    });

    it('an unexpected extra property', () => {
      expect(
        validateMessageRequest('zone.create', {
          userId: 'u',
          name: 'Home',
          username: 'me',
          evil: true,
        }).valid
      ).toBe(false);
    });

    it('null where a string is required', () => {
      expect(
        validateMessageResponse('zone.create', {
          id: 'z',
          name: null,
          joinCode: 'ABCD1234',
          status: 'ACTIVE',
          ownerUserId: null,
          config: {},
        }).valid
      ).toBe(false);
    });

    it('accepts null for a genuinely nullable field (regression guard)', () => {
      expect(
        validateMessageResponse('zone.create', {
          id: 'z',
          name: 'Home',
          joinCode: 'ABCD1234',
          status: 'ACTIVE',
          ownerUserId: null,
          config: {},
        }).valid
      ).toBe(true);
    });

    it('catalog item.create rejects a missing required enum (plan 0012)', () => {
      expect(
        validateMessageRequest('item.create', {
          userId: 'owner',
          name: { en: 'Milk', es: 'Leche' },
          defaultUnit: 'LITER',
        }).valid
      ).toBe(false);
    });
  });
});
