import { IDENTITY_EVENTS } from '../lib/events/identity.events';
import { RealtimeEvent } from '../lib/events/realtime.events';
import { AUTH_PATTERNS } from '../lib/messages/auth.messages';
import {
  ITEM_PATTERNS,
  PRICE_SCOPE_PATTERNS,
  SUPERMARKET_ITEM_PATTERNS,
  SUPERMARKET_LOCATION_ITEM_PATTERNS,
  SUPERMARKET_LOCATION_PATTERNS,
  SUPERMARKET_PATTERNS,
} from '../lib/messages/catalog.messages';
import {
  DISCOVERED_PLACE_PATTERNS,
  HARVEST_PATTERNS,
  ITEM_SOURCE_REF_PATTERNS,
  SOURCE_ENTRY_PATTERNS,
  SUPERMARKET_SOURCE_PATTERNS,
} from '../lib/messages/harvest.messages';
import {
  COMMENT_PATTERNS,
  LINE_PATTERNS,
  LIST_PATTERNS,
} from '../lib/messages/list.messages';
import { MERGE_PATTERNS } from '../lib/messages/merge.messages';
import { REALTIME_ACCESS_PATTERNS } from '../lib/messages/realtime.messages';
import { RECONCILIATION_PATTERNS } from '../lib/messages/reconciliation.messages';
import { STATS_PATTERNS } from '../lib/messages/stats.messages';
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
      ...Object.values(SUPERMARKET_LOCATION_ITEM_PATTERNS),
      ...Object.values(PRICE_SCOPE_PATTERNS),
      ...Object.values(HARVEST_PATTERNS),
      ...Object.values(DISCOVERED_PLACE_PATTERNS),
      ...Object.values(ITEM_SOURCE_REF_PATTERNS),
      ...Object.values(SOURCE_ENTRY_PATTERNS),
      ...Object.values(SUPERMARKET_SOURCE_PATTERNS),
      ...Object.values(STATS_PATTERNS),
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

    it('an event addressed to a person carries users and no zone (plan 0030)', () => {
      expect(
        validateEvent('zone.created', {
          event: 'zone.created',
          eventId: 'e3',
          userIds: ['u1'],
          payload: { id: 'z', name: 'Flat 3B' },
        }).valid
      ).toBe(true);
    });

    it('the re-published rename is a different subject from the identity event', () => {
      // Same name on the wire to the client, two envelopes on the broker
      // (plan 0030, section 4.3): the identity one is a service to service
      // message, this one is a fan-out subject.
      expect(
        validateEvent('user.usernameChanged.broadcast', {
          event: 'user.usernameChanged',
          eventId: 'e4',
          userIds: ['u1'],
          payload: { userId: 'u1', username: 'Vela Rápida' },
        }).valid
      ).toBe(true);
      expect(
        validateEvent('user.usernameChanged.broadcast', {
          eventId: 'e4',
          userId: 'u1',
          oldUsername: 'Swift Sail',
          newUsername: 'Vela Rápida',
          propagation: 'ALL_ZONES',
        }).valid
      ).toBe(false);
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
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        }).valid
      ).toBe(true);
    });

    it('line.add response (both enum states, free text line)', () => {
      expect(
        validateMessageResponse('line.add', {
          id: 'l',
          listId: 'li',
          content: 'Milk',
          quantity: 1,
          // A free text line, which is what most lines are: an empty set and a
          // null hash, both stated rather than left out (plan 0048, 1.1).
          itemIds: [],
          itemSetHash: null,
          position: 1,
          approvalStatus: 'PENDING',
          status: 'PENDING',
          createdByUserId: 'u',
          approvedByUserId: null,
          version: 1,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
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

    it('line.add request may carry a product set (plan 0048, section 1.1)', () => {
      // Picking a group in the composer copies its members here, so a set of
      // several is the ordinary case rather than the exotic one.
      expect(
        validateMessageRequest('line.add', {
          userId: 'u',
          listId: 'li',
          content: 'Milk',
          itemIds: ['item-1', 'item-2'],
        }).valid
      ).toBe(true);
      // ...and omitting it entirely is still a plain line.
      expect(
        validateMessageRequest('line.add', {
          userId: 'u',
          listId: 'li',
          content: 'Something for dinner',
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
              ean: null,
              unitSize: null,
              category: 'DAIRY',
              defaultUnit: 'LITER',
              productGroupId: null,
            },
          ],
          nextCursor: null,
        }).valid
      ).toBe(true);
    });

    it('an item search with scopes quotes a price on the item (plan 0048)', () => {
      // `bestOffer` is optional and absent everywhere else, which is what let it
      // be added to the one view every catalog read already answers with.
      expect(
        validateMessageResponse('item.search', {
          items: [
            {
              id: 'i',
              name: { en: 'Milk', es: 'Leche' },
              brand: 'Pascual',
              imageUrl: null,
              sku: null,
              ean: null,
              unitSize: 1,
              category: 'DAIRY',
              defaultUnit: 'LITER',
              productGroupId: 'g',
              bestOffer: {
                itemId: 'i',
                priceScopeId: 's',
                price: 1.15,
                currency: 'EUR',
                unitPrice: 1.15,
                unitPriceLabel: 'L',
                priceObservedAt: '2026-08-30T10:00:00.000Z',
                priceSourceKind: 'OFFICIAL_API',
              },
            },
          ],
          nextCursor: null,
        }).valid
      ).toBe(true);
    });

    it('item.searchOffers returns a group with no priced member (plan 0048, section 3)', () => {
      // The case, not the edge case: the harvester is off outside development,
      // so a group whose members carry no price is most of the catalog, and it
      // still has to be suggestible.
      expect(
        validateMessageResponse('item.searchOffers', {
          items: [
            {
              group: {
                id: 'g',
                name: { en: 'Milk', es: 'Leche' },
                slug: 'milk',
                referenceUnit: 'LITER',
                synonyms: { en: ['milk'], es: ['leche'] },
              },
              cheapestItem: null,
              offer: null,
            },
          ],
          nextCursor: null,
        }).valid
      ).toBe(true);
    });

    it('item.searchOffers takes scopes, and takes none (plan 0048, section 3.1)', () => {
      expect(
        validateMessageRequest('item.searchOffers', {
          userId: 'u',
          query: 'leche',
          priceScopeIds: ['s1', 's2'],
        }).valid
      ).toBe(true);
      // No scopes is not an error. It means no prices, and the suggestions still
      // work; resolving a default from the profile is plan 0049.
      expect(
        validateMessageRequest('item.searchOffers', { userId: 'u', query: 'leche' })
          .valid
      ).toBe(true);
    });

    it('productGroup.create requires a slug and a reference unit (plan 0048)', () => {
      expect(
        validateMessageRequest('productGroup.create', {
          userId: 'owner',
          name: { en: 'Milk', es: 'Leche' },
          slug: 'milk',
          referenceUnit: 'LITER',
          synonyms: { en: ['milk'], es: ['leche'] },
        }).valid
      ).toBe(true);
      // Without the unit there is no answer to "cheaper per what", which is the
      // only question a group exists to make askable.
      expect(
        validateMessageRequest('productGroup.create', {
          userId: 'owner',
          name: { en: 'Milk', es: 'Leche' },
          slug: 'milk',
        }).valid
      ).toBe(false);
    });

    it('harvest.spawn request + harvest.run.get response (plan 0038)', () => {
      expect(
        validateMessageRequest('harvest.spawn', {
          userId: 'owner',
          mode: 'STORE_DISCOVERY',
          postalCode: '14013',
          country: 'ES',
          radiusMetres: 3000,
        }).valid
      ).toBe(true);
      expect(
        validateMessageResponse('harvest.run.get', {
          id: 'r',
          // Null because a store discovery run belongs to a postal code and a
          // radius, not to one chain (plan 0038, section 4.2).
          supermarketId: null,
          sourceId: null,
          mode: 'STORE_DISCOVERY',
          trigger: 'MANUAL',
          status: 'RUNNING',
          requestedAt: '2026-08-30T10:00:00.000Z',
          startedAt: '2026-08-30T10:00:01.000Z',
          finishedAt: null,
          heartbeatAt: '2026-08-30T10:00:11.000Z',
          totalPlanned: 26,
          processed: 12,
          created: 12,
          updated: 0,
          unchanged: 0,
          notFound: 0,
          failed: 0,
          stage: 'OVERPASS',
          stageLabel: 'Querying OpenStreetMap',
          abortRequestedAt: null,
          error: null,
          correlationId: 'c',
          requestedByUserId: 'owner',
        }).valid
      ).toBe(true);
    });

    it('supermarketItem.upsertBatch reports what it refused to overwrite (plan 0038, section 6.5)', () => {
      expect(
        validateMessageRequest('supermarketItem.upsertBatch', {
          userId: 'owner',
          priceScopeId: 'scope-1',
          priceSourceKind: 'OFFICIAL_API',
          entries: [
            {
              itemId: 'i',
              price: 1.8,
              currency: 'EUR',
              unitPrice: 4.5,
              // The source's own label, verbatim. It reads "100 ml" on a per
              // litre number, which is why it is text and not a unit.
              unitPriceLabel: '100 ml',
              available: true,
              priceObservedAt: '2026-08-30T10:00:00.000Z',
            },
          ],
        }).valid
      ).toBe(true);
      expect(
        validateMessageResponse('supermarketItem.upsertBatch', {
          created: 0,
          updated: 0,
          unchanged: 0,
          skipped: [
            {
              itemId: 'i',
              storedPrice: 1.75,
              storedSourceKind: 'ADMIN',
              fetchedPrice: 1.8,
            },
          ],
        }).valid
      ).toBe(true);
    });

    it('zone.get response carries the summary and the preview (plan 0017)', () => {
      expect(
        validateMessageResponse('zone.get', {
          id: 'z',
          name: 'Home',
          joinCode: 'ABCD1234',
          status: 'ACTIVE',
          ownerUserId: 'u',
          config: {},
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          myRole: 'OWNER',
          myStatus: 'APPROVED',
          counts: {
            memberCount: 3,
            listCount: 2,
            pendingRequestCount: 1,
            firstPendingRequesterName: 'Ines',
          },
          lists: [{ id: 'l', name: 'Groceries', lineCount: 12, readyCount: 7 }],
          ownerUsername: 'Marc',
        }).valid
      ).toBe(true);
    });

    it('a zone summary may withhold governance and preview nothing (plan 0017, section 6)', () => {
      expect(
        validateMessageResponse('zone.get', {
          id: 'z',
          name: 'Home',
          joinCode: 'ABCD1234',
          status: 'ACTIVE',
          ownerUserId: 'u',
          config: {},
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          myRole: 'MEMBER',
          myStatus: 'APPROVED',
          counts: {
            memberCount: 3,
            listCount: 0,
            pendingRequestCount: null,
            firstPendingRequesterName: null,
          },
          lists: [],
          ownerUsername: 'Marc',
        }).valid
      ).toBe(true);
    });

    it('a pending applicant is named the approver but no governance (plan 0024, section 2)', () => {
      // The combination the waiting card needs, and the one a careless
      // authorization change is most likely to break in either direction.
      expect(
        validateMessageResponse('zone.get', {
          id: 'z',
          name: 'Flat 3B',
          joinCode: 'ABCD1234',
          status: 'ACTIVE',
          ownerUserId: 'u',
          config: {},
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          myRole: 'MEMBER',
          myStatus: 'PENDING',
          counts: {
            memberCount: 3,
            listCount: 0,
            pendingRequestCount: null,
            firstPendingRequesterName: null,
          },
          lists: [],
          ownerUsername: 'Marc',
        }).valid
      ).toBe(true);
    });

    it('a zone that lost its owner has no owner name (plan 0024, section 2.2)', () => {
      expect(
        validateMessageResponse('zone.get', {
          id: 'z',
          name: 'Home',
          joinCode: 'ABCD1234',
          status: 'ACTIVE',
          ownerUserId: null,
          config: {},
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          myRole: 'ADMIN',
          myStatus: 'APPROVED',
          counts: {
            memberCount: 3,
            listCount: 0,
            pendingRequestCount: 0,
            firstPendingRequesterName: null,
          },
          lists: [],
          ownerUsername: null,
        }).valid
      ).toBe(true);
    });

    it('zone.getByCode request and response (plan 0024, section 1.2)', () => {
      expect(
        validateMessageRequest('zone.getByCode', { joinCode: 'ABCD1234' }).valid
      ).toBe(true);
      expect(
        validateMessageResponse('zone.getByCode', {
          name: 'Flat 3B',
          memberCount: 4,
        }).valid
      ).toBe(true);
    });

    it('zone.countsMine response (plan 0017, section 3.5)', () => {
      expect(
        validateMessageResponse('zone.countsMine', {
          owned: 1,
          joined: 2,
          pending: 1,
          total: 3,
        }).valid
      ).toBe(true);
    });

    it('membership.list request and page (plan 0017, section 5)', () => {
      expect(
        validateMessageRequest('membership.list', {
          userId: 'u',
          zoneId: 'z',
          statuses: ['PENDING'],
          order: 'joined',
        }).valid
      ).toBe(true);
      expect(
        validateMessageResponse('membership.list', {
          items: [
            {
              id: 'm',
              zoneId: 'z',
              userId: 'u',
              username: 'Ines',
              role: 'MEMBER',
              status: 'PENDING',
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
          ],
          nextCursor: null,
        }).valid
      ).toBe(true);
    });

    it('list.create response carries its line counts (plan 0017, section 3.4)', () => {
      expect(
        validateMessageResponse('list.create', {
          id: 'l',
          zoneId: 'z',
          name: 'Groceries',
          createdByUserId: 'u',
          counts: { lineCount: 0, readyCount: 0 },
          autoApproveLines: false,
          sharedWithZone: true,
          myPermissions: ['READ', 'WRITE', 'DECIDE', 'MANAGE'],
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        }).valid
      ).toBe(true);
    });

    it('list.getAccess returns the stored rows only (plan 0036, section 6)', () => {
      expect(
        validateMessageResponse('list.getAccess', {
          listId: 'l',
          entries: [{ membershipId: 'm', permissions: ['READ', 'DECIDE'] }],
        }).valid
      ).toBe(true);
    });

    it('zone.countsUpdated travels in the domain event envelope (plan 0017, section 9)', () => {
      expect(
        validateEvent('zone.countsUpdated', {
          event: 'zone.countsUpdated',
          eventId: 'e1',
          zoneId: 'z',
          payload: {
            zoneId: 'z',
            counts: {
              memberCount: 3,
              pendingRequestCount: null,
              firstPendingRequesterName: null,
            },
          },
        }).valid
      ).toBe(true);
    });

    it('stats.identity and stats.core (plan 0017, section 8)', () => {
      expect(validateMessageRequest('stats.identity', {}).valid).toBe(true);
      expect(
        validateMessageResponse('stats.identity', {
          users: 10,
          registeredUsers: 7,
          temporaryUsers: 3,
        }).valid
      ).toBe(true);
      expect(
        validateMessageResponse('stats.core', { zones: 4, activeZones: 3 })
          .valid
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
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
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
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
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

    it('a zone summary must not omit the counts block (plan 0017)', () => {
      expect(
        validateMessageResponse('zone.get', {
          id: 'z',
          name: 'Home',
          joinCode: 'ABCD1234',
          status: 'ACTIVE',
          ownerUserId: 'u',
          config: {},
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          myRole: 'OWNER',
          myStatus: 'APPROVED',
          lists: [],
        }).valid
      ).toBe(false);
    });

    it('the by code preview may not carry the zone id (plan 0024, section 1.2)', () => {
      // The schema is the enforcement of "exactly two fields": an id would turn
      // a scraped code into a stable handle for the zone.
      expect(
        validateMessageResponse('zone.getByCode', {
          id: 'z',
          name: 'Flat 3B',
          memberCount: 4,
        }).valid
      ).toBe(false);
      // ...and neither may it echo the code back, or name the owner.
      for (const leak of [{ joinCode: 'ABCD1234' }, { ownerUserId: 'u' }]) {
        expect(
          validateMessageResponse('zone.getByCode', {
            name: 'Flat 3B',
            memberCount: 4,
            ...leak,
          }).valid
        ).toBe(false);
      }
    });

    it('a zone summary must carry the owner name, even as null (plan 0024)', () => {
      expect(
        validateMessageResponse('zone.get', {
          id: 'z',
          name: 'Home',
          joinCode: 'ABCD1234',
          status: 'ACTIVE',
          ownerUserId: 'u',
          config: {},
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          myRole: 'OWNER',
          myStatus: 'APPROVED',
          counts: {
            memberCount: 1,
            listCount: 0,
            pendingRequestCount: 0,
            firstPendingRequesterName: null,
          },
          lists: [],
        }).valid
      ).toBe(false);
    });

    it('stats takes no arguments (plan 0017, section 8)', () => {
      expect(validateMessageRequest('stats.core', { zoneId: 'z' }).valid).toBe(
        false
      );
    });
  });
});
