import { Location } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { PageNavigation } from './page-navigation';

/**
 * The rule every page's top left back button now follows.
 *
 * The two cases are named here so an edit that quietly turns the pop back into a walk
 * to a fixed parent fails, which is the defect this service exists to fix: a list
 * opened from the dashboard used to send its reader to a group screen they had never
 * asked to see.
 */
function setUp(state: unknown): {
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
      { provide: Location, useValue: { back, getState: () => state } },
    ],
  });

  return { pages: TestBed.inject(PageNavigation), back, navigateByUrl };
}

describe('PageNavigation', () => {
  it('pops the entry behind this one, whatever page that is', async () => {
    const { pages, back, navigateByUrl } = setUp({ navigationId: 4 });

    await pages.back('/velista/en/zones/z1');

    expect(back).toHaveBeenCalled();
    expect(navigateByUrl).not.toHaveBeenCalled();
  });

  it('walks to the parent when the session began on this page', async () => {
    // A shared link opened cold. Nothing of this app's is behind it, so popping would
    // leave the app, and an inert button is not an option either.
    const { pages, back, navigateByUrl } = setUp({ navigationId: 1 });

    await pages.back('/velista/en/zones/z1');

    expect(back).not.toHaveBeenCalled();
    // Pushed, not replaced: the parent is a screen this session has not seen, so it is
    // a step forward and gets an entry. Only a sheet, whose URL has to stop existing,
    // replaces its own.
    expect(navigateByUrl).toHaveBeenCalledWith('/velista/en/zones/z1');
  });

  it('walks to the parent when the history says nothing at all', async () => {
    const { pages, back, navigateByUrl } = setUp(null);

    await pages.back('/velista/en/home');

    expect(back).not.toHaveBeenCalled();
    expect(navigateByUrl).toHaveBeenCalledWith('/velista/en/home');
  });
});
