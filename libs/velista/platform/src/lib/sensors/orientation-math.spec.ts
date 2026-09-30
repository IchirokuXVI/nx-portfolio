import { eulerToQuaternion, motionRow, roundTo } from './orientation-math';

type Vec = [number, number, number];

/** Rotates `v` by the quaternion `[x, y, z, w]`. */
function rotate(q: [number, number, number, number], v: Vec): Vec {
  const [x, y, z, w] = q;
  // v' = v + 2 w (u × v) + 2 u × (u × v), with u = (x, y, z).
  const u: Vec = [x, y, z];
  const c1 = cross(u, v);
  const c2 = cross(u, c1);
  return [
    v[0] + 2 * (w * c1[0] + c2[0]),
    v[1] + 2 * (w * c1[1] + c2[1]),
    v[2] + 2 * (w * c1[2] + c2[2]),
  ];
}

function cross(a: Vec, b: Vec): Vec {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

type Mat = [Vec, Vec, Vec];

function mul(a: Mat, b: Mat): Mat {
  const out: Mat = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      out[i][j] = a[i][0] * b[0][j] + a[i][1] * b[1][j] + a[i][2] * b[2][j];
    }
  }
  return out;
}

function apply(m: Mat, v: Vec): Vec {
  return [
    m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
    m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
    m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
  ];
}

const rad = (deg: number) => (deg * Math.PI) / 180;

function rz(a: number): Mat {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [
    [c, -s, 0],
    [s, c, 0],
    [0, 0, 1],
  ];
}

function rx(a: number): Mat {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [
    [1, 0, 0],
    [0, c, -s],
    [0, s, c],
  ];
}

function ry(a: number): Mat {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [
    [c, 0, s],
    [0, 1, 0],
    [-s, 0, c],
  ];
}

function must<T>(value: T | null): T {
  if (value === null) {
    throw new Error('expected a value');
  }
  return value;
}

function expectVec(actual: Vec, expected: Vec): void {
  actual.forEach((value, i) => expect(value).toBeCloseTo(expected[i], 9));
}

describe('eulerToQuaternion', () => {
  it('answers the identity for a phone lying flat, top pointing along the world y', () => {
    const q = must(eulerToQuaternion(0, 0, 0));
    expectVec(rotate(q, [1, 0, 0]), [1, 0, 0]);
    expectVec(rotate(q, [0, 1, 0]), [0, 1, 0]);
  });

  it('turns the device x into the world y for alpha 90', () => {
    const q = must(eulerToQuaternion(90, 0, 0));
    expectVec(rotate(q, [1, 0, 0]), [0, 1, 0]);
  });

  it('points the top of an upright phone up for beta 90', () => {
    const q = must(eulerToQuaternion(0, 90, 0));
    expectVec(rotate(q, [0, 1, 0]), [0, 0, 1]);
  });

  it('turns the screen normal towards the world x for gamma 90', () => {
    const q = must(eulerToQuaternion(0, 0, 90));
    expectVec(rotate(q, [0, 0, 1]), [1, 0, 0]);
  });

  it("matches Rz(alpha) Rx(beta) Ry(gamma), the Z-X'-Y'' composition, for any angles", () => {
    const cases: [number, number, number][] = [
      [30, 45, -20],
      [212.5, -60, 80],
      [359, 10, -89],
      [123, 170, 5],
    ];
    const vectors: Vec[] = [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
      [0.3, -0.7, 0.2],
    ];

    for (const [alpha, beta, gamma] of cases) {
      const q = must(eulerToQuaternion(alpha, beta, gamma));
      const m = mul(mul(rz(rad(alpha)), rx(rad(beta))), ry(rad(gamma)));
      const norm = Math.hypot(...q);
      expect(norm).toBeCloseTo(1, 12);
      for (const v of vectors) {
        expectVec(rotate(q, v), apply(m, v));
      }
    }
  });

  it('answers null when the browser has no reading', () => {
    expect(eulerToQuaternion(null, 0, 0)).toBeNull();
    expect(eulerToQuaternion(0, undefined, 0)).toBeNull();
    expect(eulerToQuaternion(0, 0, Number.NaN)).toBeNull();
  });
});

describe('motionRow', () => {
  it('writes [beta, gamma, alpha] converted from degrees to radians per second', () => {
    const row = must(
      motionRow(12.345, {
        accelerationIncludingGravity: { x: 0.1, y: 0.2, z: 9.81 },
        rotationRate: { alpha: 180, beta: 90, gamma: -45 },
      })
    );

    expect(row[0]).toBe(12.3);
    expect(row.slice(1, 4)).toEqual([0.1, 0.2, 9.81]);
    expect(row[4]).toBeCloseTo(Math.PI / 2, 4);
    expect(row[5]).toBeCloseTo(-Math.PI / 4, 4);
    expect(row[6]).toBeCloseTo(Math.PI, 4);
  });

  it('writes zeros for a missing rotation rate and nothing for a missing acceleration', () => {
    expect(
      motionRow(0, {
        accelerationIncludingGravity: { x: 0, y: 0, z: 9.8 },
        rotationRate: null,
      })
    ).toEqual([0, 0, 0, 9.8, 0, 0, 0]);
    expect(
      motionRow(0, {
        accelerationIncludingGravity: { x: null, y: 0, z: 9.8 },
        rotationRate: null,
      })
    ).toBeNull();
    expect(
      motionRow(0, { accelerationIncludingGravity: null, rotationRate: null })
    ).toBeNull();
  });
});

describe('roundTo', () => {
  it('keeps at most the digits asked for', () => {
    expect(roundTo(1.23456, 2)).toBe(1.23);
    expect(roundTo(-0.00004, 4)).toBe(-0);
  });
});
