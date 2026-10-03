import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseOpeningHours } from './hours';

const hoursOf = (name: string): unknown =>
  JSON.parse(readFileSync(join(__dirname, '__fixtures__', name), 'utf8'))[
    'horariosTienda'
  ];

describe('parseOpeningHours', () => {
  it('joins the days with equal hours, and writes Sunday apart', () => {
    // The fixture shop opens later on Sunday, and every Sunday of the month is
    // among its holiday dates. That is what confirms key 7 is Sunday and the
    // week starts on Monday (plan 0174, section 5.5).
    expect(parseOpeningHours(hoursOf('store-detail-normal.json'))).toEqual({
      openingHours: 'Mo-Sa 08:30-22:00; Su 10:00-22:00',
      readable: true,
    });
  });

  it('joins a whole week of equal hours into one rule', () => {
    expect(parseOpeningHours(hoursOf('store-detail-hub.json'))).toEqual({
      openingHours: 'Mo-Su 06:00-22:00',
      readable: true,
    });
  });

  it('writes a day the shop does not list as closed', () => {
    expect(parseOpeningHours(hoursOf('store-detail-leaflet.json'))).toEqual({
      openingHours: 'Mo-Sa 09:00-21:30; Su off',
      readable: true,
    });
  });

  it('writes a split day as two ranges', () => {
    const split = '09:00 - 14:30 | 17:00 - 21:00';
    expect(
      parseOpeningHours({
        '1': split,
        '2': split,
        '3': split,
        '4': split,
        '5': split,
        '6': '07:30 - 13:00',
      }).openingHours
    ).toBe('Mo-Fr 09:00-14:30,17:00-21:00; Sa 07:30-13:00; Su off');
  });

  it('writes a closed day in the middle of the week on its own', () => {
    expect(
      parseOpeningHours({ '1': '9:00 - 21:00', '3': '09:00 - 21:00' })
        .openingHours
    ).toBe('Mo 09:00-21:00; Tu off; We 09:00-21:00; Th-Su off');
  });

  it('answers unreadable for a value it cannot read, and guesses nothing', () => {
    expect(
      parseOpeningHours({ '1': '09:00 - 21:00', '2': 'Consultar en tienda' })
    ).toEqual({ openingHours: null, readable: false });
    expect(parseOpeningHours({ '1': '25:00 - 26:00' }).readable).toBe(false);
  });

  it('answers unreadable for a key that is not a day, and for no object', () => {
    expect(parseOpeningHours({ '8': '09:00 - 21:00' }).readable).toBe(false);
    expect(parseOpeningHours({}).readable).toBe(false);
    expect(parseOpeningHours(null).readable).toBe(false);
    expect(parseOpeningHours(['09:00 - 21:00']).readable).toBe(false);
  });
});
