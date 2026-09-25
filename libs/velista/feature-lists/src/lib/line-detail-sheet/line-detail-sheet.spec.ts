import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import {
  RokuLocaleStore,
  RokuTranslatorTestingModule,
} from '@portfolio/localization/rokutranslator-angular';
import {
  boughtShopRecord,
  fakeItemNames,
  fakeLineStore,
  fakeListStore,
  fakeMemberNames,
  GatewayError,
  provideFakeItemNames,
  provideFakeLineStore,
  provideFakeListStore,
  provideFakeMemberNames,
  provideFakeSessionStore,
  REALTIME_CLIENT,
  RealtimeMemory,
  type FakeItemNames,
} from '@portfolio/velista/data-access';
import type {
  BasketShop,
  CatalogItem,
  Line,
  LineSettlement,
  ListPermission,
  ShoppingListSummary,
} from '@portfolio/velista/models';
import {
  BrowserFacade,
  fakeBrowserFacade,
  provideVelistaTesting,
  SheetNavigation,
  StorageKeys,
} from '@portfolio/velista/platform';
import { QuantityReel, SheetShell } from '@portfolio/velista/ui';
import { BehaviorSubject } from 'rxjs';
import { LineDetailSheet } from './line-detail-sheet';

/**
 * The sheet, at the DOM, for the four things velista plan `0047` puts on it.
 *
 * The selector's own spec covers what the sheet **says**; this covers what reaches the
 * screen: names that came from the service rather than from a fixture, a failure that
 * is drawn as a failure and never as "no products", and the row's indicators on the
 * header.
 */

const ZONE_ID = '8f14e45f-ceea-4e2c-9e0b-9c1a6a3f2b71';
const LIST_ID = '3c9a1d02-5f47-4b8e-9a1c-7d2e6b4f0a35';
const LINE_ID = 'ln-1';
const ME = 'user-me';

const ADMIN: readonly ListPermission[] = ['READ', 'WRITE', 'DECIDE', 'MANAGE'];
/** `content` scope on an approved line: a writer who cannot decide. */
const WRITER: readonly ListPermission[] = ['READ', 'WRITE'];
const READ_ONLY: readonly ListPermission[] = ['READ'];

const MILK: CatalogItem = {
  id: 'item-milk-a',
  name: { es: 'Leche entera', en: 'Whole milk' },
  brand: 'Hacendado',
  size: 1,
  unit: 'LITER',
  productGroupId: null,
};

function line(overrides: Partial<Line> = {}): Line {
  return {
    id: LINE_ID,
    listId: LIST_ID,
    content: 'Milk',
    quantity: 2,
    itemIds: ['item-milk-a'],
    productGroupId: null,
    groupItemIds: [],
    position: 1,
    approvalStatus: 'APPROVED',
    boughtCount: 0,
    lastSettlementOutcome: null,
    createdByUserId: ME,
    approvedByUserId: ME,
    version: 1,
    ...overrides,
  };
}

function list(
  permissions: readonly ListPermission[] = ADMIN,
  autoApproveLines = false
): ShoppingListSummary {
  return {
    id: LIST_ID,
    zoneId: ZONE_ID,
    name: 'Weekly shop',
    createdByUserId: ME,
    autoApproveLines,
    lineCount: 1,
    wantedCount: 1,
    myPermissions: permissions,
  };
}

interface Options {
  readonly lines?: readonly Line[];
  readonly itemNames?: FakeItemNames;
  readonly settlements?: Readonly<Record<string, readonly LineSettlement[]>>;
  readonly claims?: Readonly<Record<string, string>>;
  readonly permissions?: readonly ListPermission[];
  readonly autoApproveLines?: boolean;
  readonly commentCount?: number;
  readonly state?: 'loading' | 'loaded';
  /** This device's storage, for the remembered shop (velista `0114`). */
  readonly storage?: Map<string, string>;
}

async function render(options: Options = {}): Promise<{
  fixture: ComponentFixture<LineDetailSheet>;
  itemNames: FakeItemNames;
  sheets: { dismiss: jest.Mock; leaveTo: jest.Mock };
  lines: ReturnType<typeof fakeLineStore>;
  realtime: RealtimeMemory;
  router: { navigate: jest.Mock; navigateByUrl: jest.Mock };
}> {
  TestBed.resetTestingModule();

  const lines = fakeLineStore({
    lines: options.lines ?? [line()],
    state: options.state ?? 'loaded',
    settlements: options.settlements ?? { [LINE_ID]: [] },
    claims: options.claims,
  });
  if (options.commentCount !== undefined) {
    lines.recordCommentCount(LINE_ID, options.commentCount);
  }
  const realtime = new RealtimeMemory();
  const router = {
    navigate: jest.fn().mockResolvedValue(true),
    navigateByUrl: jest.fn().mockResolvedValue(true),
  };

  const sheets = {
    dismiss: jest.fn().mockResolvedValue(undefined),
    leaveTo: jest.fn().mockResolvedValue(undefined),
  };
  const itemNames = options.itemNames ?? fakeItemNames({ items: [MILK] });
  const map = convertToParamMap({
    zoneId: ZONE_ID,
    listId: LIST_ID,
    lineId: LINE_ID,
  });
  // A subject, so a navigation to another line of the same route can be played the way
  // the router plays it: the component is reused and only the parameters change.
  const params = new BehaviorSubject(map);
  const snapshot = { paramMap: map, parent: null };
  sheets.leaveTo.mockImplementation(async (url: string) => {
    const lineId = /\/lines\/([^/]+)\/detail$/.exec(url)?.[1];
    if (lineId !== undefined) {
      const next = convertToParamMap({
        zoneId: ZONE_ID,
        listId: LIST_ID,
        lineId,
      });
      snapshot.paramMap = next;
      params.next(next);
    }
  });

  await TestBed.configureTestingModule({
    imports: [LineDetailSheet, RokuTranslatorTestingModule.forTesting()],
    providers: [
      provideVelistaTesting({ basePath: '/velista' }),
      provideFakeLineStore(lines),
      provideFakeListStore(
        fakeListStore({
          lists: [list(options.permissions ?? ADMIN, options.autoApproveLines)],
          state: 'loaded',
        })
      ),
      provideFakeMemberNames(fakeMemberNames({ 'user-ana': 'Ana' })),
      provideFakeItemNames(itemNames),
      provideFakeSessionStore('REGISTERED'),
      { provide: REALTIME_CLIENT, useValue: realtime },
      {
        provide: BrowserFacade,
        useValue: fakeBrowserFacade(options.storage ?? new Map()),
      },
      { provide: SheetNavigation, useValue: sheets },
      { provide: Router, useValue: router },
      { provide: RokuLocaleStore, useValue: { locale: signal('en') } },
      {
        provide: ActivatedRoute,
        useValue: {
          paramMap: params,
          snapshot,
          parent: null,
        },
      },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(LineDetailSheet);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();

  return { fixture, itemNames, sheets, lines, realtime, router };
}

/** Let every awaited promise settle, then draw. */
async function settle(
  fixture: ComponentFixture<LineDetailSheet>
): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
  }
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
}

const nameField = (
  fixture: ComponentFixture<LineDetailSheet>
): HTMLInputElement | null =>
  fixture.nativeElement.querySelector('#line-detail-name');

const saveButton = (
  fixture: ComponentFixture<LineDetailSheet>
): HTMLButtonElement | null => fixture.nativeElement.querySelector('.save');

function type(fixture: ComponentFixture<LineDetailSheet>, value: string): void {
  const input = nameField(fixture) as HTMLInputElement;
  input.value = value;
  input.dispatchEvent(new Event('input'));
  fixture.detectChanges();
}

function moveReel(
  fixture: ComponentFixture<LineDetailSheet>,
  to: number
): void {
  const reel = fixture.debugElement.query(By.directive(QuantityReel));
  reel.triggerEventHandler('committedTo', { from: 2, to });
  fixture.detectChanges();
}

function button(
  fixture: ComponentFixture<LineDetailSheet>,
  key: string
): HTMLButtonElement | undefined {
  return (
    [...fixture.nativeElement.querySelectorAll('button')] as HTMLButtonElement[]
  ).find((candidate) => candidate.textContent?.includes(key));
}

function mergeRefusal(): GatewayError {
  return new GatewayError({
    code: 'line_merge_required',
    status: 409,
    correlationId: 'c',
    details: { otherLineId: 'ln-2', otherContent: 'Bread', otherQuantity: 3 },
  });
}

/**
 * What reached the DOM, as **keys**.
 *
 * The testing translator emits the key rather than a sentence and interpolates
 * nothing, so a spec asserting on English would be asserting on the translator. Every
 * question here is "was this drawn", which a key answers exactly; the one question that
 * is about a value, the product's name, is asked of the view model instead.
 */
const textOf = (fixture: ComponentFixture<LineDetailSheet>): string =>
  fixture.nativeElement.textContent ?? '';

describe('LineDetailSheet', () => {
  it('asks the service for the line products, once, as a set', async () => {
    // One request for the set rather than one per product, which is the acceptance
    // criterion the batch route exists for.
    const { itemNames } = await render({
      lines: [line({ itemIds: ['item-milk-a', 'item-milk-b'] })],
    });

    expect(itemNames.asked).toEqual([['item-milk-a', 'item-milk-b']]);
  });

  it('names the product from the service, not from a fixture', async () => {
    const { fixture } = await render();

    // The name is a value rather than a key, so it is asked of the view model: the
    // testing translator interpolates nothing, and `products.one` reaches the DOM
    // without its argument whatever the argument is.
    expect(fixture.componentInstance.detail()?.productsArgs).toEqual({
      name: 'Whole milk',
    });
  });

  it('says the names could not be loaded, and never that the line has no products', async () => {
    // The defect this plan is about, at the DOM. A failed lookup used to take the
    // template's empty branch and tell the reader their line carried nothing.
    const { fixture } = await render({
      itemNames: fakeItemNames({ items: [], failed: ['item-milk-a'] }),
    });

    const text = textOf(fixture);
    expect(text).toContain('list.detail.namesFailed');
    expect(text).not.toContain('list.page.noProducts');
    expect(text).not.toContain('list.detail.products.none');
    // The count survives the failure, because the count is a fact about the line.
    expect(text).toContain('list.detail.products.unnamed');
  });

  it('says nothing about names on a line that genuinely has no products', async () => {
    const { fixture } = await render({ lines: [line({ itemIds: [] })] });

    const text = textOf(fixture);
    expect(text).toContain('list.detail.products.none');
    expect(text).not.toContain('list.detail.namesFailed');
  });

  it('shows the same indicators as the row it opened from', async () => {
    // A settled line: at zero with a purchase on record, which is what the row draws
    // "bought" from. The header used to be passed `[]` and drew nothing at all.
    const { fixture } = await render({
      lines: [line({ quantity: 0, boughtCount: 1 })],
    });

    expect(textOf(fixture)).toContain('line.indicator.bought');
    expect(fixture.componentInstance.detail()?.indicators).toEqual(['bought']);
  });

  it('draws no indicators on an ordinary line', async () => {
    const { fixture } = await render();

    expect(textOf(fixture)).not.toContain('line.indicator.');
  });

  it('names who is out buying it, as the row does', async () => {
    const { fixture } = await render({ claims: { [LINE_ID]: 'user-ana' } });

    expect(textOf(fixture)).toContain('line.indicator.claimedBy');
    expect(fixture.componentInstance.detail()?.claimedBy).toBe('Ana');
  });

  /**
   * The way out of the sheet, and the difference between the two ways.
   *
   * `dismiss` gives back the screen underneath and pops the history to do it, so it
   * ignores the URL it is handed whenever there is something to pop. Sending the line
   * page through it therefore did not open the line page: it went back to the list,
   * which is the defect these two assert against, and it is invisible in any test that
   * only checks which URL was built.
   */
  describe('leaving it', () => {
    it('travels to the line page rather than popping back to the list', async () => {
      const { fixture, sheets } = await render();

      await fixture.componentInstance.openPage();

      expect(sheets.leaveTo).toHaveBeenCalledWith(
        `/velista/en/zones/${ZONE_ID}/lists/${LIST_ID}/lines/${LINE_ID}`
      );
      expect(sheets.dismiss).not.toHaveBeenCalled();
    });

    it('still dismisses to the list, which is what cancelling means', async () => {
      const { fixture, sheets } = await render();

      await fixture.componentInstance.dismiss();

      expect(sheets.dismiss).toHaveBeenCalledWith(
        `/velista/en/zones/${ZONE_ID}/lists/${LIST_ID}`
      );
      expect(sheets.leaveTo).not.toHaveBeenCalled();
    });
  });

  describe('editing the line (velista plan 0083)', () => {
    it('draws the name and Save for both scopes, the reel only for full, and neither with no scope', async () => {
      const full = await render();
      expect(nameField(full.fixture)?.value).toBe('Milk');
      expect(saveButton(full.fixture)).not.toBeNull();
      expect(
        full.fixture.debugElement.query(By.directive(QuantityReel))
      ).not.toBeNull();
      // The header's pill goes, because the reel is the same number.
      expect(full.fixture.nativeElement.querySelector('.quantity')).toBeNull();

      const content = await render({ permissions: WRITER });
      expect(nameField(content.fixture)).not.toBeNull();
      expect(saveButton(content.fixture)).not.toBeNull();
      expect(
        content.fixture.debugElement.query(By.directive(QuantityReel))
      ).toBeNull();
      expect(
        content.fixture.nativeElement.querySelector('.shown')?.textContent
      ).toContain('2');

      const none = await render({ permissions: READ_ONLY });
      expect(nameField(none.fixture)).toBeNull();
      expect(saveButton(none.fixture)).toBeNull();
      expect(
        none.fixture.nativeElement.querySelector('.quantity')
      ).not.toBeNull();
    });

    it('keeps the dialog labelled by the saved name while the field changes', async () => {
      const { fixture } = await render();
      type(fixture, 'Oat milk');

      const title = fixture.nativeElement.querySelector('#line-detail-title');
      expect(title?.textContent?.trim()).toBe('Milk');
      expect(title?.classList.contains('visually-hidden')).toBe(true);
      expect(
        fixture.nativeElement.querySelector('label[for="line-detail-name"]')
      ).not.toBeNull();
    });

    it('enables Save only for a change, and never for a blank name', async () => {
      const { fixture } = await render();
      expect(saveButton(fixture)?.disabled).toBe(true);

      type(fixture, 'Oat milk');
      expect(saveButton(fixture)?.disabled).toBe(false);

      type(fixture, '   ');
      expect(saveButton(fixture)?.disabled).toBe(true);

      type(fixture, 'Milk');
      expect(saveButton(fixture)?.disabled).toBe(true);
    });

    it('sends only what changed', async () => {
      const { fixture, lines } = await render();

      type(fixture, 'Oat milk ');
      saveButton(fixture)?.click();
      await settle(fixture);
      expect(lines.calls.at(-1)).toEqual({
        kind: 'update',
        lineId: LINE_ID,
        content: 'Oat milk',
      });

      moveReel(fixture, 5);
      saveButton(fixture)?.click();
      await settle(fixture);
      expect(lines.calls.at(-1)).toEqual({
        kind: 'update',
        lineId: LINE_ID,
        quantity: 5,
      });
    });

    it('never sends the amount in content scope', async () => {
      const { fixture, lines } = await render({ permissions: WRITER });

      type(fixture, 'Oat milk');
      saveButton(fixture)?.click();
      await settle(fixture);

      expect(lines.calls.at(-1)).toEqual({
        kind: 'update',
        lineId: LINE_ID,
        content: 'Oat milk',
      });
    });

    it('warns about unapproval only with a change, and only when it applies', async () => {
      const warned = await render({ permissions: WRITER });
      expect(textOf(warned.fixture)).not.toContain('list.edit.unapproves');
      type(warned.fixture, 'Oat milk');
      expect(textOf(warned.fixture)).toContain('list.edit.unapproves');

      const auto = await render({
        permissions: WRITER,
        autoApproveLines: true,
      });
      type(auto.fixture, 'Oat milk');
      expect(textOf(auto.fixture)).not.toContain('list.edit.unapproves');

      const admin = await render();
      type(admin.fixture, 'Oat milk');
      expect(textOf(admin.fixture)).not.toContain('list.edit.unapproves');
    });

    it('puts Saved on the button after a save, and Save back on the next change', async () => {
      const { fixture, sheets } = await render();

      type(fixture, 'Oat milk');
      saveButton(fixture)?.click();
      await settle(fixture);

      expect(saveButton(fixture)?.textContent).toContain('list.detail.saved');
      expect(saveButton(fixture)?.disabled).toBe(true);
      expect(saveButton(fixture)?.getAttribute('aria-live')).toBe('polite');
      // The sheet stays open on the saved values.
      expect(sheets.dismiss).not.toHaveBeenCalled();
      expect(nameField(fixture)?.value).toBe('Oat milk');

      type(fixture, 'Oat milk, 2 L');
      expect(saveButton(fixture)?.textContent).toContain('list.edit.save');
      expect(saveButton(fixture)?.disabled).toBe(false);
    });

    it('redraws clean fields from a socket update and leaves edited ones alone', async () => {
      const { fixture, lines } = await render();

      lines.set([line({ content: 'Whole milk', quantity: 4, version: 2 })]);
      await settle(fixture);
      expect(nameField(fixture)?.value).toBe('Whole milk');
      expect(fixture.componentInstance.amount()).toBe(4);

      type(fixture, 'Oat milk');
      lines.set([line({ content: 'Skimmed milk', quantity: 6, version: 3 })]);
      await settle(fixture);
      expect(nameField(fixture)?.value).toBe('Oat milk');
      expect(fixture.componentInstance.name()).toBe('Oat milk');
    });

    it('keeps what was typed through the store renaming the line and snapping it back', async () => {
      // The real store renames the row as the save goes out and puts the old name back
      // on a refusal. The fields must read neither as an update to redraw from.
      const { fixture, lines } = await render();
      lines.answerNextUpdate({ state: 'failed', error: mergeRefusal() });
      lines.holdWrites();

      type(fixture, 'Bread');
      saveButton(fixture)?.click();
      lines.set([line({ content: 'Bread', version: 1 })]);
      await settle(fixture);
      lines.set([line()]);
      await settle(fixture);
      lines.releaseWrites();
      await settle(fixture);

      button(fixture, 'list.merge.keepEditing')?.click();
      await settle(fixture);

      expect(nameField(fixture)?.value).toBe('Bread');
      expect(saveButton(fixture)?.disabled).toBe(false);
    });

    it('announces the edit on focus, and clears it after a save and on destroy', async () => {
      const { fixture, realtime } = await render();
      const editing = jest.spyOn(realtime, 'setEditingLine');

      nameField(fixture)?.dispatchEvent(new Event('focus'));
      expect(editing).toHaveBeenLastCalledWith(LIST_ID, LINE_ID);

      type(fixture, 'Oat milk');
      saveButton(fixture)?.click();
      await settle(fixture);
      expect(editing).toHaveBeenLastCalledWith(LIST_ID, null);

      moveReel(fixture, 4);
      expect(editing).toHaveBeenLastCalledWith(LIST_ID, LINE_ID);
      fixture.destroy();
      expect(editing).toHaveBeenLastCalledWith(LIST_ID, null);
    });

    describe('while a save is in flight', () => {
      it('cannot be dismissed, reads only, and disables everything else', async () => {
        const { fixture, lines } = await render({ commentCount: 2 });
        lines.holdWrites();

        type(fixture, 'Oat milk');
        saveButton(fixture)?.click();
        fixture.detectChanges();

        const shell = fixture.debugElement.query(By.directive(SheetShell))
          .componentInstance as SheetShell;
        expect(shell.dismissible()).toBe(false);
        expect(nameField(fixture)?.readOnly).toBe(true);
        expect(
          fixture.debugElement
            .query(By.directive(QuantityReel))
            .componentInstance.readonly()
        ).toBe(true);
        expect(saveButton(fixture)?.getAttribute('aria-busy')).toBe('true');
        for (const key of [
          'list.detail.bought',
          'list.detail.notAvailable',
          'list.line.comments',
          'list.detail.delete',
          'list.detail.everything',
        ]) {
          expect(button(fixture, key)?.disabled).toBe(true);
        }

        lines.releaseWrites();
        await settle(fixture);
        expect(shell.dismissible()).toBe(true);
        expect(button(fixture, 'list.line.comments')?.disabled).toBe(false);
      });

      it('cannot be dismissed while a settle is out either', async () => {
        const { fixture, lines } = await render();
        lines.holdWrites();

        void fixture.componentInstance.recordNotAvailable();
        fixture.detectChanges();

        const shell = fixture.debugElement.query(By.directive(SheetShell))
          .componentInstance as SheetShell;
        expect(shell.dismissible()).toBe(false);

        lines.releaseWrites();
        await settle(fixture);
      });
    });

    describe('the merge question', () => {
      it('asks in place of the sheet, naming the other line and both amounts', async () => {
        const { fixture, lines } = await render();
        lines.answerNextUpdate({ state: 'failed', error: mergeRefusal() });

        type(fixture, 'Bread');
        moveReel(fixture, 4);
        saveButton(fixture)?.click();
        await settle(fixture);

        expect(fixture.componentInstance.merge()).toEqual({
          other: 'Bread',
          otherQuantity: 3,
          total: 7,
        });
        const text = textOf(fixture);
        expect(text).toContain('list.merge.taken');
        expect(text).toContain('list.merge.question');
        expect(text).toContain('list.merge.keeps');
        expect(nameField(fixture)).toBeNull();
        // The question takes focus, so it is what is read first.
        expect(document.activeElement).toBe(
          fixture.nativeElement.querySelector('.merge-taken')
        );
      });

      it('merges by sending the same save again with confirmMerge', async () => {
        const { fixture, lines, sheets } = await render();
        lines.answerNextUpdate({ state: 'failed', error: mergeRefusal() });

        type(fixture, 'Bread');
        saveButton(fixture)?.click();
        await settle(fixture);

        button(fixture, 'list.merge.confirm')?.click();
        await settle(fixture);

        expect(lines.calls.at(-1)).toEqual({
          kind: 'update',
          lineId: LINE_ID,
          content: 'Bread',
          confirmMerge: true,
        });
        expect(fixture.componentInstance.merge()).toBeNull();
        // This line survived, so the sheet stays where it is.
        expect(sheets.leaveTo).not.toHaveBeenCalled();
        // The pane's button is gone, so focus stays in the dialog on its title.
        expect(document.activeElement).toBe(
          fixture.nativeElement.querySelector('#line-detail-title')
        );
      });

      it('returns to the fields with the typed values, and focus on Save', async () => {
        const { fixture, lines } = await render();
        lines.answerNextUpdate({ state: 'failed', error: mergeRefusal() });

        type(fixture, 'Bread');
        moveReel(fixture, 4);
        saveButton(fixture)?.click();
        await settle(fixture);

        button(fixture, 'list.merge.keepEditing')?.click();
        await settle(fixture);

        expect(nameField(fixture)?.value).toBe('Bread');
        expect(fixture.componentInstance.amount()).toBe(4);
        expect(document.activeElement).toBe(saveButton(fixture));
      });

      it('follows the survivor with leaveTo when this line was absorbed', async () => {
        const { fixture, lines, sheets } = await render({
          lines: [
            line(),
            line({ id: 'ln-2', content: 'Bread', quantity: 3, position: 0 }),
          ],
        });
        lines.answerNextUpdate({ state: 'failed', error: mergeRefusal() });
        lines.answerNextUpdate({
          state: 'succeeded',
          line: { id: 'ln-2', quantity: 5 },
          absorbedLineId: LINE_ID,
        });

        type(fixture, 'Bread');
        saveButton(fixture)?.click();
        await settle(fixture);
        button(fixture, 'list.merge.confirm')?.click();
        await settle(fixture);

        expect(sheets.leaveTo).toHaveBeenCalledWith(
          `/velista/en/zones/${ZONE_ID}/lists/${LIST_ID}/sheet/lines/ln-2/detail`
        );
        // The reused sheet is about the survivor now, and does not close as if its line
        // had gone.
        expect(sheets.dismiss).not.toHaveBeenCalled();
        expect(fixture.componentInstance.lineId()).toBe('ln-2');
        expect(nameField(fixture)?.value).toBe('Bread');
        // The fields show the survivor's summed amount, not the amount typed here.
        expect(fixture.componentInstance.amount()).toBe(5);
        expect(saveButton(fixture)?.disabled).toBe(true);
        expect(document.activeElement).toBe(
          fixture.nativeElement.querySelector('#line-detail-title')
        );
      });
    });

    describe('the other two refusals', () => {
      it('says a pending line cannot take an approved line name', async () => {
        const { fixture, lines } = await render();
        lines.answerNextUpdate({
          state: 'failed',
          error: new GatewayError({
            code: 'line_merge_needs_approval',
            status: 409,
            correlationId: 'c',
          }),
        });

        type(fixture, 'Bread');
        saveButton(fixture)?.click();
        await settle(fixture);

        const alert = fixture.nativeElement.querySelector('[role="alert"]');
        expect(alert?.textContent).toContain('list.error.mergeNeedsApproval');
        expect(nameField(fixture)?.value).toBe('Bread');
        expect(fixture.componentInstance.merge()).toBeNull();
      });

      it('says the two together hold too many products, with the bound', async () => {
        const { fixture, lines } = await render();
        lines.answerNextUpdate({
          state: 'failed',
          error: new GatewayError({
            code: 'line_merge_too_many_products',
            status: 409,
            correlationId: 'c',
            details: { max: 100, offered: 104 },
          }),
        });

        type(fixture, 'Bread');
        saveButton(fixture)?.click();
        await settle(fixture);

        const alert = fixture.nativeElement.querySelector('[role="alert"]');
        expect(alert?.textContent).toContain('list.error.mergeTooManyProducts');
        expect(fixture.componentInstance.saveErrorArgs()).toEqual({ max: 100 });
        expect(nameField(fixture)?.value).toBe('Bread');
      });
    });

    describe('comments and delete', () => {
      it('pushes both with navigateByUrl, never leaveTo', async () => {
        const { fixture, router, sheets } = await render();

        button(fixture, 'list.line.comments')?.click();
        await settle(fixture);
        button(fixture, 'list.detail.delete')?.click();
        await settle(fixture);

        expect(router.navigateByUrl.mock.calls.map((call) => call[0])).toEqual([
          `/velista/en/zones/${ZONE_ID}/lists/${LIST_ID}/sheet/lines/${LINE_ID}/comments`,
          `/velista/en/zones/${ZONE_ID}/lists/${LIST_ID}/sheet/lines/${LINE_ID}/confirm/delete`,
        ]);
        expect(sheets.leaveTo).not.toHaveBeenCalled();
      });

      it('draws Comments for a reader, and Delete only where it is allowed', async () => {
        const reader = await render({ permissions: READ_ONLY });
        expect(button(reader.fixture, 'list.line.comments')).toBeDefined();
        expect(button(reader.fixture, 'list.detail.delete')).toBeUndefined();

        // A writer on an approved line edits it and may not delete it.
        const writer = await render({ permissions: WRITER });
        expect(button(writer.fixture, 'list.detail.delete')).toBeUndefined();

        const admin = await render();
        expect(button(admin.fixture, 'list.detail.delete')).toBeDefined();
      });

      it('carries the comment count, in the name as well', async () => {
        const { fixture } = await render({ commentCount: 2 });
        const comments = button(fixture, 'list.line.comments');

        expect(
          comments?.querySelector('.more-count')?.textContent?.trim()
        ).toBe('2');
        expect(comments?.getAttribute('aria-label')).toBe(
          'list.detail.commentsLabel'
        );

        const quiet = await render();
        expect(
          button(quiet.fixture, 'list.line.comments')?.hasAttribute(
            'aria-label'
          )
        ).toBe(false);
      });
    });
  });

  describe('when the line is gone (velista plan 0083)', () => {
    it('closes quietly, once, when this reader deleted it', async () => {
      const { fixture, lines, sheets } = await render();

      await lines.deleteLine(LINE_ID);
      await settle(fixture);

      expect(sheets.dismiss).toHaveBeenCalledTimes(1);
      expect(textOf(fixture)).not.toContain('list.gone.');
    });

    it('says another user deleted it, and closes once when told', async () => {
      const { fixture, lines, sheets } = await render();

      lines.deleteByOthers(LINE_ID);
      await settle(fixture);

      expect(textOf(fixture)).toContain('list.gone.byOthers');
      expect(sheets.dismiss).not.toHaveBeenCalled();
      expect(
        fixture.nativeElement.querySelector('#line-detail-title')?.textContent
      ).toContain('list.gone.byOthers');

      button(fixture, 'list.gone.close')?.click();
      await settle(fixture);

      expect(lines.deletionOf(LINE_ID)).toBe('seen');
      expect(sheets.dismiss).toHaveBeenCalledTimes(1);
    });

    it('says a line that is not on a fully loaded list is no longer available', async () => {
      const { fixture, sheets } = await render({ lines: [] });

      expect(textOf(fixture)).toContain('list.gone.unavailable');
      expect(sheets.dismiss).not.toHaveBeenCalled();
    });

    it('says nothing while the list is still loading', async () => {
      const { fixture } = await render({ lines: [], state: 'loading' });

      expect(textOf(fixture)).not.toContain('list.gone.');
    });

    it('closes quietly once the reader has been told, from another sheet', async () => {
      const { fixture, lines, sheets } = await render();

      lines.deleteByOthers(LINE_ID);
      lines.acknowledgeDeletion(LINE_ID);
      await settle(fixture);

      expect(textOf(fixture)).not.toContain('list.gone.');
      expect(sheets.dismiss).toHaveBeenCalledTimes(1);
    });
  });

  describe('where it was bought (velista 0114)', () => {
    const SHOP: BasketShop = {
      id: 'loc-1',
      supermarketId: 'chain-1',
      chain: { es: 'Mercadona', en: 'Mercadona' },
      label: null,
      address: 'Ronda de los Tejares 1',
      city: 'Cordoba',
      postalCode: '14008',
      inProfile: null,
    };

    const remembered = (): Map<string, string> =>
      new Map([[StorageKeys.boughtShop, boughtShopRecord(SHOP, Date.now())]]);

    async function openStep(
      fixture: ComponentFixture<LineDetailSheet>
    ): Promise<void> {
      button(fixture, 'list.detail.bought')?.click();
      await settle(fixture);
    }

    async function record(
      fixture: ComponentFixture<LineDetailSheet>
    ): Promise<void> {
      button(fixture, 'list.detail.record')?.click();
      await settle(fixture);
    }

    it('asks where, says Not specified, and settles exactly as before with no shop', async () => {
      const { fixture, lines } = await render();

      await openStep(fixture);
      expect(textOf(fixture)).toContain('list.detail.shop.label');
      expect(textOf(fixture)).toContain('list.detail.shop.none');
      expect(fixture.nativeElement.querySelector('.shop-clear')).toBeNull();

      await record(fixture);
      const call = lines.calls.at(-1);
      expect(call).toMatchObject({ kind: 'settle', outcome: 'BOUGHT' });
      expect(call).not.toHaveProperty('supermarketLocationId');
    });

    it('starts on the shop this device named last, and sends it', async () => {
      const { fixture, lines } = await render({ storage: remembered() });

      await openStep(fixture);
      expect(textOf(fixture)).toContain('Mercadona');
      expect(textOf(fixture)).toContain('Ronda de los Tejares 1, Cordoba');

      await record(fixture);
      expect(lines.calls.at(-1)).toMatchObject({
        kind: 'settle',
        outcome: 'BOUGHT',
        supermarketLocationId: SHOP.id,
      });
    });

    it('clears the shop, sends none, and stops offering it', async () => {
      const storage = remembered();
      const { fixture, lines } = await render({ storage });

      await openStep(fixture);
      (
        fixture.nativeElement.querySelector('.shop-clear') as HTMLButtonElement
      ).click();
      await settle(fixture);

      expect(textOf(fixture)).toContain('list.detail.shop.none');
      expect(storage.has(StorageKeys.boughtShop)).toBe(false);

      await record(fixture);
      expect(lines.calls.at(-1)).not.toHaveProperty('supermarketLocationId');
    });

    it('remembers a picked shop, back on the step, and sends it', async () => {
      const storage = new Map<string, string>();
      const { fixture, lines } = await render({ storage });

      await openStep(fixture);
      // The picker itself is the shared body's to test; here it is its output.
      fixture.componentInstance.step.set('shop');
      fixture.componentInstance.onShopPicked(SHOP);
      await settle(fixture);

      expect(fixture.componentInstance.step()).toBe('howMany');
      expect(storage.has(StorageKeys.boughtShop)).toBe(true);
      expect(textOf(fixture)).toContain('Mercadona');

      await record(fixture);
      expect(lines.calls.at(-1)).toMatchObject({
        supermarketLocationId: SHOP.id,
      });
    });

    it('never names a shop for "they did not have it"', async () => {
      const { fixture, lines } = await render({ storage: remembered() });

      await fixture.componentInstance.recordNotAvailable();
      await settle(fixture);

      expect(lines.calls.at(-1)).toMatchObject({ outcome: 'NOT_AVAILABLE' });
      expect(lines.calls.at(-1)).not.toHaveProperty('supermarketLocationId');
    });
  });
});
