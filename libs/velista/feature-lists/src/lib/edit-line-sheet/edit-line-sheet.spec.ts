import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import {
  RokuLocaleStore,
  RokuTranslatorTestingModule,
} from '@portfolio/localization/rokutranslator-angular';
import {
  fakeLineStore,
  provideFakeLineStore,
  REALTIME_CLIENT,
  RealtimeMemory,
} from '@portfolio/velista/data-access';
import type { Line } from '@portfolio/velista/models';
import { provideVelistaTesting } from '@portfolio/velista/platform';
import { of } from 'rxjs';
import { EditLineSheet } from './edit-line-sheet';

const ZONE_ID = '8f14e45f-ceea-4e2c-9e0b-9c1a6a3f2b71';
const LIST_ID = '3c9a1d02-5f47-4b8e-9a1c-7d2e6b4f0a35';
const LINE_ID = 'ln-1';

/**
 * Plan 0022, section 2.2, and acceptance criterion 6.
 *
 * The sheet is where the edit intent lives, and its whole life is the sheet's. What is
 * worth a test is the exit: saving, cancelling, a back gesture and a navigation away
 * are four ways out, and `DestroyRef` is the one hook all four reach. A release written
 * on save and cancel instead would be right three times and would leave a line looking
 * locked on the fourth.
 */
function line(overrides: Partial<Line> = {}): Line {
  return {
    id: LINE_ID,
    listId: LIST_ID,
    content: 'Sourdough loaf',
    quantity: 1,
    itemId: null,
    position: 1,
    approvalStatus: 'APPROVED',
    status: 'PENDING',
    createdByUserId: 'u1',
    approvedByUserId: 'u1',
    version: 1,
    ...overrides,
  };
}

async function render(lines: readonly Line[] = [line()]): Promise<{
  fixture: ComponentFixture<EditLineSheet>;
  realtime: RealtimeMemory;
}> {
  TestBed.resetTestingModule();

  const realtime = new RealtimeMemory();
  // The page underneath is what holds the room, and the server refuses a presence
  // intent from a socket that is not in it. Taking it here is that page, in one line.
  realtime.viewList(LIST_ID);

  const map = convertToParamMap({
    zoneId: ZONE_ID,
    listId: LIST_ID,
    lineId: LINE_ID,
  });

  await TestBed.configureTestingModule({
    imports: [EditLineSheet, RokuTranslatorTestingModule.forTesting()],
    providers: [
      provideVelistaTesting({ basePath: '/velista' }),
      provideFakeLineStore(fakeLineStore({ lines, state: 'loaded' })),
      { provide: REALTIME_CLIENT, useValue: realtime },
      {
        provide: Router,
        useValue: {
          navigate: jest.fn().mockResolvedValue(true),
          navigateByUrl: jest.fn().mockResolvedValue(true),
        },
      },
      { provide: RokuLocaleStore, useValue: { locale: signal('en') } },
      {
        provide: ActivatedRoute,
        useValue: {
          paramMap: of(map),
          snapshot: { paramMap: map, parent: null },
          parent: null,
        },
      },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(EditLineSheet);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();

  return { fixture, realtime };
}

describe('EditLineSheet', () => {
  it('says which line is being edited while it is open', async () => {
    const { realtime } = await render();

    expect(realtime.editedLines.get(LIST_ID)).toBe(LINE_ID);
  });

  // The one that matters. Destroy is what a save, a cancel, a back gesture and a
  // navigation away all reach, so it is the only hook that cannot be right three
  // times out of four.
  it('stops saying so when the sheet goes, however it went', async () => {
    const { fixture, realtime } = await render();

    fixture.destroy();

    expect(realtime.editedLines.get(LIST_ID)).toBeUndefined();
  });

  // A deep link onto a list that has not loaded. The sheet dismisses rather than
  // showing empty fields somebody could save over nothing, and there is no line to
  // announce, so it announces nothing.
  it('announces nothing when there is no line to edit', async () => {
    const { realtime } = await render([]);

    expect(realtime.editedLines.has(LIST_ID)).toBe(false);
  });
});
