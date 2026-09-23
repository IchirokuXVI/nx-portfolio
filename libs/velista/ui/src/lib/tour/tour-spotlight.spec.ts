import { placeCard } from './tour-spotlight';

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
