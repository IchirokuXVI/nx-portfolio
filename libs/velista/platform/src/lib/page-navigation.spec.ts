import { Location } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { AppHistory } from './app-history';
import { PageNavigation } from './page-navigation';

/**
 * The rule every page's top left back button now follows.
 *
 * The two cases are named here so an edit that quietly turns the pop back into a walk
 * to a fixed parent fails, which is the defect this service exists to fix: a list
 * opened from the dashboard used to send its reader to a group screen they had never
 * asked to see.
 *
 * The other direction is the reason `fallbackUrl` is required rather than optional. A
 * back button with nothing of ours behind it may not pop, because what is behind it is
 * another site. Which arrivals leave nothing of ours behind is `AppHistory`'s subject,
 * and `app-history.spec.ts` works through them; this spec only cares that a no sends
 * the reader to the URL the screen named.
 */
function setUp(entryBehind: boolean): {
  pages: PageNavigation;
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

  return { pages: TestBed.inject(PageNavigation), back, navigateByUrl };
}

describe('PageNavigation', () => {
  it('pops the entry behind this one, whatever page that is', async () => {
    const { pages, back, navigateByUrl } = setUp(true);

    await pages.back('/velista/en/zones/z1');

    expect(back).toHaveBeenCalled();
    expect(navigateByUrl).not.toHaveBeenCalled();
  });

  it('walks to the fallback when nothing of this app is behind the page', async () => {
    // A shared link opened cold, and every arrival that only looks deeper than it is.
    // Popping would leave the app for whichever site linked the reader here, and an
    // inert button is not an option either.
    const { pages, back, navigateByUrl } = setUp(false);

    await pages.back('/velista/en/zones/z1');

    expect(back).not.toHaveBeenCalled();
    // Pushed, not replaced: the parent is a screen this session has not seen, so it is
    // a step forward and gets an entry. Only a sheet, whose URL has to stop existing,
    // replaces its own.
    expect(navigateByUrl).toHaveBeenCalledWith('/velista/en/zones/z1');
  });
});
