import { TestBed } from '@angular/core/testing';
import { AppHistory } from './app-history';
import { PageReturn } from './page-return';

/**
 * A page keeps what it showed as it goes, and gets it back only on a return: the
 * back button onto it, or forward again. Any other arrival is a fresh visit.
 */
function setUp(): { returns: PageReturn; arriving: { byPop: boolean } } {
  const arriving = { byPop: false };

  TestBed.configureTestingModule({
    providers: [
      {
        provide: AppHistory,
        useValue: { arrivingByPop: () => arriving.byPop },
      },
    ],
  });

  return { returns: TestBed.inject(PageReturn), arriving };
}

describe('PageReturn', () => {
  it('hands back what the page kept when it is returned to', () => {
    const { returns, arriving } = setUp();

    returns.keep('list:l1', { words: 'milk', scrollTop: 420 });
    arriving.byPop = true;

    expect(returns.recall('list:l1')).toEqual({
      words: 'milk',
      scrollTop: 420,
    });
  });

  it('hands back nothing on a fresh visit, and forgets it', () => {
    const { returns, arriving } = setUp();

    returns.keep('list:l1', { words: 'milk' });
    expect(returns.recall('list:l1')).toBeNull();

    // Back onto the page after that visit finds nothing of the one before it.
    arriving.byPop = true;
    expect(returns.recall('list:l1')).toBeNull();
  });

  it('hands a snapshot back once', () => {
    const { returns, arriving } = setUp();

    returns.keep('list:l1', { words: 'milk' });
    arriving.byPop = true;
    returns.recall('list:l1');

    expect(returns.recall('list:l1')).toBeNull();
  });

  it('keeps each page under its own key, and the latest snapshot of each', () => {
    const { returns, arriving } = setUp();

    returns.keep('list:l1', { words: 'milk' });
    returns.keep('list:l1', { words: 'bread' });
    returns.keep('list:l2', { words: 'eggs' });
    arriving.byPop = true;

    expect(returns.recall('list:l1')).toEqual({ words: 'bread' });
    expect(returns.recall('list:l2')).toEqual({ words: 'eggs' });
    expect(returns.recall('basket:live')).toBeNull();
  });
});
