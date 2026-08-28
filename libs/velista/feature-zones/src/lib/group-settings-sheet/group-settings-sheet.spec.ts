import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import {
  RokuLocaleStore,
  RokuTranslatorTestingModule,
} from '@portfolio/localization/rokutranslator-angular';
import {
  fakeZoneStore,
  GatewayError,
  provideFakeZoneStore,
  type FakeZoneStore,
} from '@portfolio/velista/data-access';
import type { MyZone } from '@portfolio/velista/models';
import { provideVelistaTesting } from '@portfolio/velista/platform';
import { of } from 'rxjs';
import { GroupSettingsSheet } from './group-settings-sheet';

/**
 * Plan 0011 section 3: minting a new code is the **end** of a task, not a step in one.
 *
 * It used to drop the confirm and leave the settings sheet showing the name field, so
 * the new code was two layers behind the person who had just asked for it.
 */
const ZONE_ID = '8f14e45f-ceea-4e2c-9e0b-9c1a6a3f2b71';

function zone(): MyZone {
  return {
    id: ZONE_ID,
    name: 'Flat 3B',
    joinCode: 'HK7M2QPD',
    status: 'ACTIVE',
    ownerUserId: 'u1',
    myRole: 'OWNER',
    myStatus: 'APPROVED',
    counts: {
      memberCount: 3,
      listCount: 2,
      pendingRequestCount: 0,
      firstPendingRequesterName: null,
    },
    lists: [],
  };
}

async function render(
  respondToWrite?: Parameters<typeof fakeZoneStore>[0]['respondToWrite']
): Promise<{
  fixture: ComponentFixture<GroupSettingsSheet>;
  zones: FakeZoneStore;
  router: { navigate: jest.Mock; navigateByUrl: jest.Mock };
}> {
  TestBed.resetTestingModule();

  const zones = fakeZoneStore({ zones: [zone()], respondToWrite });
  const router = {
    navigate: jest.fn().mockResolvedValue(true),
    navigateByUrl: jest.fn().mockResolvedValue(true),
  };
  const map = convertToParamMap({ zoneId: ZONE_ID });

  await TestBed.configureTestingModule({
    imports: [GroupSettingsSheet, RokuTranslatorTestingModule.forTesting()],
    providers: [
      provideVelistaTesting({ basePath: '/velista' }),
      provideFakeZoneStore(zones),
      { provide: Router, useValue: router },
      { provide: RokuLocaleStore, useValue: { locale: signal('en') } },
      {
        provide: ActivatedRoute,
        useValue: {
          paramMap: of(map),
          snapshot: { paramMap: map, parent: null, data: {} },
          parent: null,
        },
      },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(GroupSettingsSheet);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();

  return { fixture, zones, router };
}

describe('GroupSettingsSheet', () => {
  describe('minting a new join code', () => {
    it('closes both sheets, so the group page is what is left on screen', async () => {
      const { fixture, router } = await render();

      await fixture.componentInstance.regenerate();

      expect(router.navigateByUrl).toHaveBeenCalledWith(
        `/velista/en/zones/${ZONE_ID}`
      );
    });

    it('records the change, so the invite card can say the code is new', async () => {
      const { fixture, zones } = await render();

      await fixture.componentInstance.regenerate();

      expect(zones.lastCodeChange()).toBe(ZONE_ID);
    });

    it('keeps the confirm open and says why when it fails', async () => {
      const { fixture, router } = await render(() => ({
        state: 'failed',
        error: new GatewayError({
          code: 'forbidden',
          status: 403,
          correlationId: 'ref-1',
        }),
      }));

      fixture.componentInstance.pending.set('regenerate');
      await fixture.componentInstance.regenerate();
      fixture.detectChanges();

      expect(router.navigateByUrl).not.toHaveBeenCalled();
      expect(fixture.componentInstance.pending()).toBe('regenerate');
      expect(fixture.componentInstance.errorKey()).not.toBeNull();
    });
  });
});
