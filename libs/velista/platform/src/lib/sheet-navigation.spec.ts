import { Location } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { SheetNavigation } from './sheet-navigation';

/**
 * The rule every sheet in the app closes by, on its own.
 *
 * `create-group-sheet-back-button.spec.ts` proves the behaviour over a real router and
 * a real history stack, once, with one sheet. This spec is the cheap half: it states
 * the decision itself, so the two cases stay named and a future edit that quietly turns
 * a pop back into a push fails here as well as there.
 */
function setUp(state: unknown): {
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
      { provide: Location, useValue: { back, getState: () => state } },
    ],
  });

  return { sheets: TestBed.inject(SheetNavigation), back, navigateByUrl };
}

describe('SheetNavigation', () => {
  describe('dismissing', () => {
    it('pops the entry the sheet was opened with', async () => {
      // The whole fix. Navigating to the page underneath would push it on top of the
      // sheet, and the next back press would land on the sheet again (plan 0031).
      const { sheets, back, navigateByUrl } = setUp({ navigationId: 4 });

      await sheets.dismiss('/velista/en/home');

      expect(back).toHaveBeenCalled();
      expect(navigateByUrl).not.toHaveBeenCalled();
    });

    it('replaces its entry when the sheet is where the session began', async () => {
      // A cold arrival on the sheet's URL, or a reload with it open. There is nothing
      // of this app's behind it, so popping would leave the app entirely.
      const { sheets, back, navigateByUrl } = setUp({ navigationId: 1 });

      await sheets.dismiss('/velista/en/home');

      expect(back).not.toHaveBeenCalled();
      expect(navigateByUrl).toHaveBeenCalledWith('/velista/en/home', {
        replaceUrl: true,
      });
    });

    it('replaces its entry when the history says nothing at all', async () => {
      // A state this app did not write, which is every entry a server render or an
      // outside navigation left behind. Unreadable is read as nothing to pop.
      const { sheets, back, navigateByUrl } = setUp(null);

      await sheets.dismiss('/velista/en/home');

      expect(back).not.toHaveBeenCalled();
      expect(navigateByUrl).toHaveBeenCalledWith('/velista/en/home', {
        replaceUrl: true,
      });
    });

    it('reads a navigation id that is not a number as nothing to pop', async () => {
      const { sheets, back } = setUp({ navigationId: '4' });

      await sheets.dismiss('/velista/en/home');

      expect(back).not.toHaveBeenCalled();
    });
  });

  describe('leaving for somewhere else', () => {
    it('replaces the sheet, however deep the history is', async () => {
      // The dashboard after a group is made, the front door after an account is
      // deleted. The work is done, so the form must not be one press away.
      const { sheets, back, navigateByUrl } = setUp({ navigationId: 9 });

      await sheets.leaveTo('/velista/en/home');

      expect(back).not.toHaveBeenCalled();
      expect(navigateByUrl).toHaveBeenCalledWith('/velista/en/home', {
        replaceUrl: true,
      });
    });
  });
});
