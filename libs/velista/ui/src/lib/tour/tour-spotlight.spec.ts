import { TestBed, type ComponentFixture } from '@angular/core/testing';
import {
  cardMaxHeight,
  placeCard,
  ringOnScreen,
  TourSpotlight,
} from './tour-spotlight';

// Measured in the browser walk on a 390 by 844 phone: the groups section of a new
// account is 401 tall from 232, and the card is 218.
const VIEWPORT = 844;
const CARD = 218;

describe('placeCard', () => {
  it('puts the card on the preferred side when it fits', () => {
    expect(
      placeCard(
        { top: 8, left: 282, width: 52, height: 52 },
        'below',
        CARD,
        VIEWPORT
      )
    ).toEqual({ top: 68, bottom: null });
    expect(
      placeCard(
        { top: 751, left: -4, width: 398, height: 97 },
        'above',
        CARD,
        VIEWPORT
      )
    ).toEqual({ top: null, bottom: 101 });
  });

  it('moves it to the other side rather than under the screen edge', () => {
    // Below would end at 669 + 218 = 887, past the bottom of an 844 screen.
    expect(
      placeCard(
        { top: 260, left: 12, width: 366, height: 401 },
        'below',
        CARD,
        VIEWPORT
      )
    ).toEqual({ top: null, bottom: 844 - 260 + 8 });
  });

  it('keeps it on screen when neither side has room', () => {
    // The groups section of a new account, as the walk measured it: 6 short above.
    expect(
      placeCard(
        { top: 232, left: 12, width: 366, height: 401 },
        'below',
        CARD,
        VIEWPORT
      )
    ).toEqual({ top: null, bottom: 8 });
  });

  it('takes a card not measured yet as fitting where it prefers', () => {
    expect(
      placeCard(
        { top: 232, left: 12, width: 366, height: 401 },
        'below',
        0,
        VIEWPORT
      )
    ).toEqual({ top: 641, bottom: null });
  });
});

describe('placeCard on a screen whose frame is taller than what shows (velista 0112)', () => {
  // An installed app on Android: the fixed layer reaches 48 under the visible screen.
  const SCREEN = { visible: 800, frame: 848 };

  it('counts a card above from the frame, so it still ends over the ring', () => {
    const slot = placeCard(
      { top: 707, left: 0, width: 390, height: 93 },
      'above',
      CARD,
      SCREEN
    );

    // Measured from the frame, its bottom edge is 8 above the ring.
    expect(slot).toEqual({ top: null, bottom: 848 - 707 + 8 });
    expect(SCREEN.frame - (slot.bottom ?? 0)).toBe(707 - 8);
  });

  it('fits a card below against what shows, not against the frame', () => {
    // 600 + 8 + 218 = 826 fits the frame and not the visible 800.
    expect(
      placeCard(
        { top: 400, left: 0, width: 390, height: 200 },
        'below',
        CARD,
        SCREEN
      )
    ).toEqual({ top: null, bottom: 848 - 400 + 8 });
  });

  it('keeps the last resort on what shows', () => {
    const slot = placeCard(
      { top: 150, left: 0, width: 390, height: 600 },
      'below',
      CARD,
      SCREEN
    );

    expect(slot).toEqual({ top: null, bottom: 48 + 8 });
    expect(SCREEN.frame - (slot.bottom ?? 0)).toBe(800 - 8);
  });
});

describe('ringOnScreen (velista 0112)', () => {
  it('stands off a control in the middle of the screen', () => {
    expect(
      ringOnScreen({ top: 232, left: 12, width: 366, height: 176 }, 390, 844)
    ).toEqual({ top: 228, left: 8, width: 374, height: 184 });
  });

  it('meets the screen edge round the bar instead of going under it', () => {
    // The first stop: the bar spans the 390 screen and ends at its foot, 844.
    expect(
      ringOnScreen({ top: 755, left: 0, width: 390, height: 89 }, 390, 844)
    ).toEqual({ top: 751, left: 0, width: 390, height: 93 });
  });
});

describe('cardMaxHeight (velista 0112)', () => {
  it('leaves the screen edge free above and below', () => {
    expect(cardMaxHeight(640)).toBe(624);
    expect(cardMaxHeight(0)).toBe(0);
  });
});

describe('TourSpotlight', () => {
  let scroller: HTMLElement;
  let target: HTMLElement;
  let top: number;

  beforeEach(() => {
    top = 300;
    scroller = document.createElement('div');
    target = document.createElement('div');
    scroller.append(target);
    document.body.append(scroller);
    jest.spyOn(target, 'getBoundingClientRect').mockImplementation(
      () =>
        ({
          top,
          left: 12,
          width: 366,
          height: 48,
          right: 378,
          bottom: top + 48,
          x: 12,
          y: top,
          toJSON: () => ({}),
        }) as DOMRect
    );
  });

  afterEach(() => {
    scroller.remove();
  });

  async function render(): Promise<ComponentFixture<TourSpotlight>> {
    await TestBed.configureTestingModule({
      imports: [TourSpotlight],
    }).compileComponents();
    const fixture = TestBed.createComponent(TourSpotlight);
    fixture.componentRef.setInput('target', target);
    fixture.detectChanges();
    await fixture.whenStable();
    return fixture;
  }

  /** The ring as the component holds it now, read without running a render. */
  function ringTop(
    fixture: ComponentFixture<TourSpotlight>
  ): number | undefined {
    return (
      fixture.componentInstance as unknown as {
        ring: () => { top: number } | null;
      }
    ).ring()?.top;
  }

  it('re-measures when the page scroller scrolls, though the window does not', async () => {
    const fixture = await render();
    expect(ringTop(fixture)).toBe(296);

    // The page carried the control up by 120. The scroll event does not bubble, and
    // the window never scrolls since 0106, so only a capture listener hears it.
    top = 180;
    scroller.dispatchEvent(new Event('scroll', { bubbles: false }));

    expect(ringTop(fixture)).toBe(176);
  });

  it('stops listening once the tour is gone', async () => {
    const fixture = await render();
    fixture.destroy();

    top = 180;
    scroller.dispatchEvent(new Event('scroll', { bubbles: false }));

    expect(ringTop(fixture)).toBe(296);
  });
});
