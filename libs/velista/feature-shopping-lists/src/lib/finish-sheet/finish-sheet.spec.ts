import { signal, type WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import {
  RokuLocaleStore,
  RokuTranslatorTestingModule,
} from '@portfolio/localization/rokutranslator-angular';
import {
  BasketStore,
  GeneratedListStore,
} from '@portfolio/velista/data-access';
import {
  provideVelistaTesting,
  SheetNavigation,
} from '@portfolio/velista/platform';
import { of } from 'rxjs';
import { FinishSheet } from './finish-sheet';

/**
 * The confirmation that ends a trip (plan 0057, section 5).
 *
 * Three things are worth asserting here and the rest is copy.
 *
 * **The warning is a count**, and it is what earns the sheet: the lines nobody
 * settled are not being bought, not being dropped and not being recorded as
 * anything, and nobody can infer that from a button labelled Finish shopping. It is
 * absent at zero, because a sheet in that case would be confirming something with no
 * consequence to warn about.
 *
 * **The write goes to the owner's surface**, not to the participant one. The route
 * behind `GeneratedListStore` is account authenticated, which is what makes "the
 * owner and nobody else" a fact about the server rather than about a template.
 *
 * **The basket is re-read before the sheet closes.** The screen underneath is drawn
 * from a different store, and the socket's own word for the same change is coalesced
 * by a second and a half: a screenful of controls that stayed live that long after
 * the gesture reads as a button that did not work.
 */

const BASKET_ID = 'b4b1f0e2-1f5a-4c2e-9a4d-6f0e2b7c1d33';

interface World {
  /** How many lines nobody settled, which is what the sheet warns about. */
  readonly unsettled?: number;
  /** Whether the status write lands. False keeps the sheet open. */
  readonly lands?: boolean;
}

async function render(world: World = {}) {
  TestBed.resetTestingModule();

  const paramMap = convertToParamMap({ generatedListId: BASKET_ID });
  const unsettled: WritableSignal<number> = signal(world.unsettled ?? 0);
  const basket = {
    unsettled,
    refresh: jest.fn().mockResolvedValue(undefined),
  };
  const generated = {
    setStatus: jest.fn().mockResolvedValue(world.lands ?? true),
  };
  const sheets = {
    dismiss: jest.fn().mockResolvedValue(undefined),
    leaveTo: jest.fn().mockResolvedValue(undefined),
  };

  await TestBed.configureTestingModule({
    imports: [FinishSheet, RokuTranslatorTestingModule.forTesting()],
    providers: [
      provideVelistaTesting({ basePath: '/velista' }),
      { provide: BasketStore, useValue: basket },
      { provide: GeneratedListStore, useValue: generated },
      { provide: SheetNavigation, useValue: sheets },
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
          paramMap: of(paramMap),
          snapshot: { paramMap, parent: null },
          parent: {
            paramMap: of(paramMap),
            snapshot: { paramMap, parent: null },
            parent: null,
          },
        },
      },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(FinishSheet);
  fixture.detectChanges();

  return { fixture, basket, generated, sheets };
}

/** The footer's controls, in the order they are stacked. */
const footer = (fixture: Awaited<ReturnType<typeof render>>['fixture']) =>
  [
    ...(fixture.nativeElement as HTMLElement).querySelectorAll(
      '.footer button'
    ),
  ] as HTMLButtonElement[];

const warning = (fixture: Awaited<ReturnType<typeof render>>['fixture']) =>
  (fixture.nativeElement as HTMLElement).querySelector('.warning');

describe('FinishSheet', () => {
  describe('what it warns about', () => {
    /**
     * Asserted on the **input** rather than on the rendered sentence, which is this
     * app's rule for every interpolated string: the copy is a plural rule with a
     * count substituted into it, so a test that read the words would be testing the
     * translator rather than this component.
     */
    it('states the count of lines nobody settled', async () => {
      const { fixture } = await render({ unsettled: 3 });

      expect(fixture.componentInstance['unsettled']()).toBe(3);
      expect(warning(fixture)).not.toBeNull();
    });

    it('omits the line entirely when nothing is outstanding', async () => {
      // There is no consequence to warn about, and a sheet that warned anyway would
      // be describing something that is not going to happen.
      const { fixture } = await render({ unsettled: 0 });

      expect(warning(fixture)).toBeNull();
    });
  });

  describe('the controls', () => {
    // The order plan 0052 section 4 settled for the sheet next door: the panel grows
    // upward from the bottom of the viewport, so the safe answer takes the
    // coordinates a thumb is already aimed at.
    it('puts cancel first and the confirm after it', async () => {
      const { fixture } = await render();

      const [cancel, confirm] = footer(fixture);
      expect(cancel.textContent?.trim()).toBe('basket.finish.cancel');
      expect(confirm.textContent?.trim()).toBe('basket.finish.confirm');
    });

    /**
     * Nothing here is destroyed: the banner this draws offers Reopen, one tap and no
     * confirmation of its own (section 8). A destructive treatment would spend the
     * colour this app keeps for revoking a link on the one gesture that is trivially
     * reversible.
     */
    it('does not dress the confirm as destructive', async () => {
      const { fixture } = await render();

      const [, confirm] = footer(fixture);
      expect(confirm.classList.contains('confirm')).toBe(true);
      expect(confirm.classList.contains('destructive')).toBe(false);
    });
  });

  describe('confirming', () => {
    it('writes the finished status on the owner’s surface', async () => {
      const { fixture, generated } = await render();

      footer(fixture)[1].click();
      await fixture.whenStable();

      expect(generated.setStatus).toHaveBeenCalledWith(BASKET_ID, 'COMPLETED');
    });

    it('re-reads the basket before it closes, so the controls go with it', async () => {
      const { fixture, basket, sheets } = await render();

      footer(fixture)[1].click();
      await fixture.whenStable();

      expect(basket.refresh).toHaveBeenCalledTimes(1);
      expect(sheets.dismiss).toHaveBeenCalledWith(
        `/velista/en/shopping-lists/${BASKET_ID}`
      );
    });

    /**
     * There is nothing behind this sheet that could report the failure, so closing
     * onto a basket that is still live with no explanation is the worst of the
     * things that could happen.
     */
    it('stays open and says so when the write does not land', async () => {
      const { fixture, basket, sheets } = await render({ lands: false });

      footer(fixture)[1].click();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(sheets.dismiss).not.toHaveBeenCalled();
      expect(basket.refresh).not.toHaveBeenCalled();
      expect(
        (fixture.nativeElement as HTMLElement).querySelector('.failed')
      ).not.toBeNull();
    });
  });
});
