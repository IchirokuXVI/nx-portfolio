import { signal, type Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import {
  RokuLocaleStore,
  RokuTranslatorTestingModule,
} from '@portfolio/localization/rokutranslator-angular';
import { BasketStore } from '@portfolio/velista/data-access';
import {
  provideVelistaTesting,
  SheetNavigation,
} from '@portfolio/velista/platform';
import { SheetShell } from '@portfolio/velista/ui';
import { of } from 'rxjs';
import { PeopleSheet } from './people-sheet/people-sheet';
import { SettleSheet } from './settle-sheet/settle-sheet';
import { ShareSheet } from './share-sheet/share-sheet';

const BASKET_ID = 'b4b1f0e2-1f5a-4c2e-9a4d-6f0e2b7c1d33';
const LINE_ID = 'c0ffee00-1111-4222-8333-444455556666';

/**
 * Every sheet declared over the basket, with the path it is declared on.
 *
 * The paths are the ones in `routes.ts`, and `routes.spec.ts` asserts the route table
 * still spells them this way, so the two cannot drift apart quietly.
 *
 * A table rather than three copies, because this is a rule and not three examples: a
 * fourth sheet over this screen is one row here, and it fails until it closes the way
 * the other three do.
 */
const SHEETS: readonly {
  readonly name: string;
  readonly component: Type<unknown>;
  /** What the route consumes, which is what a relative `..` would climb one of. */
  readonly path: string;
  readonly params: Readonly<Record<string, string>>;
}[] = [
  {
    name: 'SettleSheet',
    component: SettleSheet,
    path: 'lines/:lineId/settle',
    params: { lineId: LINE_ID },
  },
  { name: 'PeopleSheet', component: PeopleSheet, path: 'people', params: {} },
  { name: 'ShareSheet', component: ShareSheet, path: 'share', params: {} },
];

/**
 * A store that answers everything and holds nothing.
 *
 * These tests are about the URL a sheet leaves on, and that URL is the same whether the
 * basket has thirty lines or none, so the emptiest store there is keeps them about it.
 */
function storeDouble() {
  return {
    basket: signal(null),
    state: signal('loaded'),
    error: signal(null),
    shareLink: signal(null),
    busyLines: signal(new Set<string>()),
    lines: signal([]),
    seesZoneData: signal(false),
    listNames: signal(new Map<string, string>()),
    participants: signal([]),
    me: signal(null),
    participantsById: signal(new Map()),
    progress: signal({ settled: 0, total: 0, spent: 0 }),
    open: jest.fn().mockResolvedValue(undefined),
    refresh: jest.fn().mockResolvedValue(undefined),
    settle: jest.fn().mockResolvedValue(null),
    setPick: jest.fn().mockResolvedValue(null),
    apply: jest.fn(),
    loadShareLink: jest.fn().mockResolvedValue(undefined),
    share: jest.fn().mockResolvedValue(null),
    revokeLink: jest.fn().mockResolvedValue(undefined),
    removeParticipant: jest.fn().mockResolvedValue(undefined),
  };
}

/**
 * The two activated routes a sheet over the basket really has: the page, which owns
 * `:generatedListId`, and the sheet, which owns whatever its own path declares.
 *
 * Two and not one, deliberately. Flattening every parameter onto the leaf would let
 * every sheet pass without walking up the tree, and walking up the tree is the whole of
 * how a sheet knows which basket it is covering.
 */
function routeTree(params: Readonly<Record<string, string>>) {
  const pageMap = convertToParamMap({ generatedListId: BASKET_ID });
  const page = {
    paramMap: of(pageMap),
    snapshot: { paramMap: pageMap, parent: null },
    parent: null,
  };

  const sheetMap = convertToParamMap(params);
  return {
    paramMap: of(sheetMap),
    snapshot: { paramMap: sheetMap, parent: page.snapshot },
    parent: page,
  };
}

async function render(
  component: Type<unknown>,
  params: Readonly<Record<string, string>>,
  basePath: string
) {
  TestBed.resetTestingModule();

  const sheets = {
    dismiss: jest.fn().mockResolvedValue(undefined),
    leaveTo: jest.fn().mockResolvedValue(undefined),
  };
  const router = {
    navigate: jest.fn().mockResolvedValue(true),
    navigateByUrl: jest.fn().mockResolvedValue(true),
  };

  await TestBed.configureTestingModule({
    imports: [component, RokuTranslatorTestingModule.forTesting()],
    providers: [
      provideVelistaTesting({ basePath }),
      { provide: BasketStore, useValue: storeDouble() },
      { provide: SheetNavigation, useValue: sheets },
      { provide: Router, useValue: router },
      { provide: RokuLocaleStore, useValue: { locale: signal('en') } },
      { provide: ActivatedRoute, useValue: routeTree(params) },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(component);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();

  return { fixture, sheets, router };
}

/** Close the sheet the way every gesture that closes one does: through the shell. */
async function close(fixture: Awaited<ReturnType<typeof render>>['fixture']) {
  fixture.debugElement
    .query(By.directive(SheetShell))
    .componentInstance.dismiss.emit();
  await fixture.whenStable();
}

/**
 * Closing a sheet over the basket, for all three of them at once.
 *
 * ## The defect this exists for
 *
 * `SettleSheet` closed with `navigate(['..'])`. Its route's path is **three** segments,
 * `lines/:lineId/settle`, and `..` climbs exactly one, so closing it left the URL on
 * `lines/:lineId`, a path no route under the basket declares, and the sheet dismissed
 * onto the app's own 404. Nothing about the sheet read as wrong: what was wrong was the
 * number of segments in a path it does not contain.
 *
 * So a relative close is not a style this app allows anywhere. It makes a component's
 * correctness depend on how long some other file's path happens to be, and it starts
 * failing silently the day that path grows a segment. Every sheet names the page it
 * covers in full, and this asserts it for all of them rather than for the one that
 * broke.
 */
describe('the sheets over the basket', () => {
  describe.each(SHEETS)('$name, declared at $path', ({ component, params }) => {
    it('closes onto the basket it covers, whole', async () => {
      const { fixture, sheets } = await render(component, params, '/velista');

      await close(fixture);

      expect(sheets.dismiss).toHaveBeenCalledWith(
        `/velista/en/shopping-lists/${BASKET_ID}`
      );
    });

    it('leaves no part of its own path behind', async () => {
      const { fixture, sheets } = await render(component, params, '/velista');

      await close(fixture);

      // The basket id is the last segment there is, so no `lines`, no line id and no
      // half climbed path can survive this. It is the assertion the defect fails.
      const [url] = sheets.dismiss.mock.calls[0] as [string];
      expect(url).toBe(`/velista/en/shopping-lists/${BASKET_ID}`);
    });

    it('names the basket in the standalone build too', async () => {
      // The mount is `/velista` under the shell and `''` when velista is served from
      // its own origin (plan 0001, the extraction contract). A sheet that wrote either
      // one down would close onto a 404 in the other, and only in the other.
      const { fixture, sheets } = await render(component, params, '');

      await close(fixture);

      expect(sheets.dismiss).toHaveBeenCalledWith(
        `/en/shopping-lists/${BASKET_ID}`
      );
    });

    it('dismisses rather than navigating, so back cannot reopen it', async () => {
      // `SheetNavigation` pops the entry the sheet was opened with; an ordinary
      // `Router.navigate` pushes a second one, and the next back press lands on the
      // sheet that was just closed and opens it again (plan 0031). Reaching the router
      // at all from a close is the shape of that defect, whatever URL it was handed.
      const { fixture, sheets, router } = await render(
        component,
        params,
        '/velista'
      );

      await close(fixture);

      expect(sheets.dismiss).toHaveBeenCalledTimes(1);
      expect(router.navigate).not.toHaveBeenCalled();
      expect(router.navigateByUrl).not.toHaveBeenCalled();
    });
  });
});
