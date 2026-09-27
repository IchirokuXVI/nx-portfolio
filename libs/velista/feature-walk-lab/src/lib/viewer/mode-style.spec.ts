import { isSnapMode, modeStyle, sortModes } from './mode-style';

describe('modeStyle', () => {
  const all = [
    'vio',
    'gps',
    ...['own', 'hw'].flatMap((steps) =>
      ['gyro', 'game', 'absolute'].flatMap((heading) => [
        `pdr:${steps}:${heading}:snap`,
        `pdr:${steps}:${heading}`,
      ])
    ),
  ];

  it('tells all fourteen modes apart by colour and dash', () => {
    expect(all).toHaveLength(14);
    const looks = new Set(all.map((mode) => JSON.stringify(modeStyle(mode))));
    expect(looks.size).toBe(14);
  });

  it('draws a snap mode solid and its unsnapped twin dashed in the same colour', () => {
    const snap = modeStyle('pdr:own:gyro:snap');
    const raw = modeStyle('pdr:own:gyro');
    expect(snap.color).toBe(raw.color);
    expect(snap.dash).toBeNull();
    expect(raw.dash).not.toBeNull();
  });

  it('answers something drawable for a mode it has never heard of', () => {
    expect(modeStyle('fused:everything').color).toMatch(/^#/);
  });
});

describe('sortModes', () => {
  it('lists the camera, then the recorder of plan 0001, then snap modes, then the rest, then GPS', () => {
    expect(
      sortModes(['gps', 'pdr:own:game', 'pdr:own:game:snap', 'pdr:own:gyro:snap', 'vio'])
    ).toEqual([
      'vio',
      'pdr:own:gyro:snap',
      'pdr:own:game:snap',
      'pdr:own:game',
      'gps',
    ]);
  });

  it('knows which modes snap', () => {
    expect(isSnapMode('pdr:hw:absolute:snap')).toBe(true);
    expect(isSnapMode('pdr:hw:absolute')).toBe(false);
    expect(isSnapMode('vio')).toBe(false);
  });
});
