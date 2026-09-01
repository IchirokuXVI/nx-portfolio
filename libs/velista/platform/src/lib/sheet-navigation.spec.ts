import { Location } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { AppHistory } from './app-history';
import { SheetNavigation } from './sheet-navigation';

/**
 * The rule every sheet in the app closes by, on its own.
 *
 * `create-group-sheet-back-button.spec.ts` proves the behaviour over a real router and
 * a real history stack, once, with one sheet. This spec is the cheap half: it states
 * the decision itself, so the two cases stay named and a future edit that quietly turns
 * a pop back into a push fails here as well as there.
 *
 * Which of the two happens is `AppHistory`'s answer, and `app-history.spec.ts` is where
 * the arrivals that produce each answer are worked through. Here it is a plain yes or
 * no, because that is all this service reads.
 */
function setUp(entryBehind: boolean): {
  sheets: SheetNavigation;
  back: jest.Mock;
  navigateByUrl: jest.Mock;
} {
  TestBed.resetTestingModule();

  const back = jest.fn();
  const navigateByUrl = jest.fn().mockResolvedValue(true);

  TestBed.configureTestingModule({
    providers: [
      { provide: Router, useValue: { navigateByUrl } },
      { provide: Location, useValue: { back } },
      { provide: AppHistory, useValue: { hasEntryBehind: () => entryBehind } },
    ],
  });

  return { sheets: TestBed.inject(SheetNavigation), back, navigateByUrl };
}

describe('SheetNavigation', () => {
  describe('dismissing', () => {
    it('pops the entry the sheet was opened with', async () => {
      // The whole fix. Navigating to the page underneath would push it on top of the
      // sheet, and the next back press would land on the sheet again (plan 0031).
      const { sheets, back, navigateByUrl } = setUp(true);

      await sheets.dismiss('/velista/en/home');

      expect(back).toHaveBeenCalled();
      expect(navigateByUrl).not.toHaveBeenCalled();
    });

    it('replaces its entry when the sheet is where the session began', async () => {
      // A cold arrival on the sheet's URL, or a reload with it open. Nothing of this
      // app's is behind it, so popping would leave the app entirely, for whichever
      // site linked the reader here.
      const { sheets, back, navigateByUrl } = setUp(false);

      await sheets.dismiss('/velista/en/home');

      expect(back).not.toHaveBeenCalled();
      expect(navigateByUrl).toHaveBeenCalledWith('/velista/en/home', {
        replaceUrl: true,
      });
    });
  });

  describe('leaving for somewhere else', () => {
    it('replaces the sheet, however deep the history is', async () => {
      // The dashboard after a group is made, the front door after an account is
      // deleted. The work is done, so the form must not be one press away.
      const { sheets, back, navigateByUrl } = setUp(true);

      await sheets.leaveTo('/velista/en/home');

      expect(back).not.toHaveBeenCalled();
      expect(navigateByUrl).toHaveBeenCalledWith('/velista/en/home', {
        replaceUrl: true,
      });
    });
  });
});
