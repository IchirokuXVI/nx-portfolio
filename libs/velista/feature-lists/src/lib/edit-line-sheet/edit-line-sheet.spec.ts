import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import {
  RokuLocaleStore,
  RokuTranslatorTestingModule,
} from '@portfolio/localization/rokutranslator-angular';
import {
  fakeLineStore,
  fakeListStore,
  provideFakeLineStore,
  provideFakeListStore,
  REALTIME_CLIENT,
  RealtimeMemory,
} from '@portfolio/velista/data-access';
import type {
  Line,
  ListPermission,
  ShoppingListSummary,
} from '@portfolio/velista/models';
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

const ADMIN: readonly ListPermission[] = ['READ', 'WRITE', 'DECIDE', 'MANAGE'];

function list(
  overrides: Partial<ShoppingListSummary> = {}
): ShoppingListSummary {
  return {
    id: LIST_ID,
    zoneId: ZONE_ID,
    name: 'Weekly shop',
    createdByUserId: 'u1',
    autoApproveLines: false,
    lineCount: 1,
    wantedCount: 0,
    myPermissions: ADMIN,
    ...overrides,
  };
}

interface Options {
  readonly lines?: readonly Line[];
  /** The list this sheet's row belongs to, which is where the mode comes from. */
  readonly list?: ShoppingListSummary;
}

async function render(options: Options = {}): Promise<{
  fixture: ComponentFixture<EditLineSheet>;
  realtime: RealtimeMemory;
}> {
  const lines = options.lines ?? [line()];
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
      provideFakeListStore(
        fakeListStore({ lists: [options.list ?? list()], state: 'loaded' })
      ),
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
    const { realtime } = await render({ lines: [] });

    expect(realtime.editedLines.has(LIST_ID)).toBe(false);
  });

  /**
   * Plan 0030, section 4; plan 0066, sections 2 and 3.
   *
   * Read off the DOM rather than off a signal, because the claim is about which fields
   * a person can actually reach: "the content and nothing else" is a statement about a
   * sheet, and a mode flag that was right while the template ignored it would pass.
   */
  describe('the two modes, and the warning', () => {
    const WRITER_ONLY = list({ myPermissions: ['READ', 'WRITE'] });

    function host(fixture: ComponentFixture<EditLineSheet>): HTMLElement {
      return fixture.nativeElement as HTMLElement;
    }

    it('makes every field live for a list admin, on an approved line', () => {
      return render().then(({ fixture }) => {
        expect(
          host(fixture).querySelector('#edit-line-content')
        ).not.toBeNull();
        expect(
          host(fixture).querySelector('lib-quantity-stepper')
        ).not.toBeNull();
        expect(host(fixture).querySelector('.shown')).toBeNull();
      });
    });

    it('makes every field live for a writer who also decides, on an approved line', async () => {
      // `WRITE` is what opens this sheet, and `DECIDE` beside it is what brings the
      // number back. `DECIDE` on its own reaches neither, which is the case below.
      const { fixture } = await render({
        list: list({ myPermissions: ['READ', 'WRITE', 'DECIDE'] }),
      });

      expect(host(fixture).querySelector('#edit-line-content')).not.toBeNull();
      expect(
        host(fixture).querySelector('lib-quantity-stepper')
      ).not.toBeNull();
    });

    it('lets a writer fix an approved line, and shows the number without a control', async () => {
      const { fixture } = await render({
        lines: [line({ quantity: 3 })],
        list: WRITER_ONLY,
      });

      expect(host(fixture).querySelector('#edit-line-content')).not.toBeNull();
      expect(host(fixture).querySelector('lib-quantity-stepper')).toBeNull();
      // Shown rather than hidden: the words being changed are the words for a number of
      // something, and a sheet that dropped the count is one you have to remember the
      // row for.
      expect(host(fixture).querySelector('.shown')?.textContent).toContain('3');
    });

    it('still opens the sheet for a writer, rather than closing on them', async () => {
      // It used to dismiss here, because a writer could not touch an approved line at
      // all. Now the edit is theirs, so the intent is announced like any other.
      const { realtime } = await render({ list: WRITER_ONLY });

      expect(realtime.editedLines.get(LIST_ID)).toBe(LINE_ID);
    });

    it('closes rather than drawing a sheet whose save would be refused', async () => {
      // A reader deep linked onto a row. The overflow would never have offered this,
      // and a URL is not a permission (rule G2).
      const { realtime } = await render({
        list: list({ myPermissions: ['READ'] }),
      });

      expect(realtime.editedLines.has(LIST_ID)).toBe(false);
    });

    it('closes on a caller holding DECIDE and no WRITE', async () => {
      // The same rule as the reader above, and worth its own case because "can approve
      // this line" reads like "can correct it". The server refuses them its content on
      // an approved line exactly as on a pending one (backend plan 0076, section 4.1),
      // so the sheet would be a screen whose save is a 403. Their quantity control is
      // the reel on the row, which this sheet is not.
      const { realtime } = await render({
        list: list({ myPermissions: ['READ', 'DECIDE'] }),
      });

      expect(realtime.editedLines.has(LIST_ID)).toBe(false);
    });

    it('says that the save will put the line back to awaiting approval', async () => {
      const { fixture } = await render({ list: WRITER_ONLY });

      expect(host(fixture).querySelector('.notice')?.textContent).toContain(
        'list.edit.unapproves'
      );
    });

    it('says nothing in the full sheet, where no approval moves', async () => {
      const { fixture } = await render();

      expect(host(fixture).querySelector('.notice')).toBeNull();
    });

    it('says nothing on a list that approves by itself', async () => {
      // Nothing re-reads that option after creation, so the server leaves the line
      // approved and the sentence would describe something that does not happen
      // (backend plan 0076, section 2.3).
      const { fixture } = await render({
        list: list({
          myPermissions: ['READ', 'WRITE'],
          autoApproveLines: true,
        }),
      });

      expect(host(fixture).querySelector('.notice')).toBeNull();
    });

    it('warns about no remainder, on any edit, in any mode', async () => {
      // Plan 0066, section 3.1. The sentence promised a second line holding the
      // difference, and backend plan 0047 deleted that behaviour along with the trip
      // status it was written in, so it warned about a row that is never created.
      for (const which of [list(), WRITER_ONLY]) {
        const { fixture } = await render({
          lines: [line({ quantity: 3 })],
          list: which,
        });

        fixture.componentInstance.quantity.set(1);
        fixture.detectChanges();

        expect(host(fixture).textContent).not.toContain('list.edit.remainder');
        expect(host(fixture).querySelector('.remainder')).toBeNull();
      }
    });
  });
});
