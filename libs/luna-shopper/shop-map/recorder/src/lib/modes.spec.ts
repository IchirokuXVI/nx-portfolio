import { availableModes, describeMode } from './modes';
import { emptyWalk } from './testing';

describe('availableModes', () => {
  it('lists every mode in the stable order when every stream is there', () => {
    const walk = emptyWalk({
      motion: [[0, 0, 0, 9.8, 0, 0, 0]],
      game: [[0, 0, 0, 0, 1]],
      absolute: [[0, 0, 0, 0, 1]],
      steps: [100],
      location: [[0, 40, -3, 10]],
      pose: [[0, 0, 0, 0, 0, 0, 0, 1]],
    });
    expect(availableModes(walk)).toEqual([
      'vio',
      'gps',
      'pdr:own:gyro:snap',
      'pdr:own:gyro',
      'pdr:own:game:snap',
      'pdr:own:game',
      'pdr:own:absolute:snap',
      'pdr:own:absolute',
      'pdr:hw:gyro:snap',
      'pdr:hw:gyro',
      'pdr:hw:game:snap',
      'pdr:hw:game',
      'pdr:hw:absolute:snap',
      'pdr:hw:absolute',
    ]);
  });

  it.each([
    [{}, []],
    [{ motion: [] }, []],
    [
      { motion: [[0, 0, 0, 9.8, 0, 0, 0]] },
      ['pdr:own:gyro:snap', 'pdr:own:gyro'],
    ],
    [
      { steps: [1], game: [[0, 0, 0, 0, 1]] },
      ['pdr:hw:game:snap', 'pdr:hw:game'],
    ],
    [{ steps: [1] }, []],
    [{ magnetic: [[0, 1, 2, 3]], pressure: [[0, 1013]] }, []],
  ])('%j answers %j', (streams, modes) => {
    expect(availableModes(emptyWalk(streams))).toEqual(modes);
  });
});

describe('describeMode', () => {
  it.each([
    ['vio', { kind: 'vio', snap: false }],
    ['gps', { kind: 'gps', snap: false }],
    [
      'pdr:own:gyro:snap',
      { kind: 'pdr', steps: 'own', heading: 'gyro', snap: true },
    ],
    [
      'pdr:hw:absolute',
      { kind: 'pdr', steps: 'hw', heading: 'absolute', snap: false },
    ],
  ])('%s', (mode, description) => {
    expect(describeMode(mode)).toEqual(description);
  });

  it.each(['pdr', 'pdr:own', 'pdr:foot:gyro', 'pdr:own:gyro:free', 'lidar'])(
    'refuses %s',
    (mode) => {
      expect(() => describeMode(mode)).toThrow(/Unknown positioning mode/);
    }
  );
});
