import { generateJoinCode } from './join-code';

describe('generateJoinCode', () => {
  it('is 8 chars from the unambiguous alphabet', () => {
    for (let i = 0; i < 200; i++) {
      const code = generateJoinCode();
      expect(code).toHaveLength(8);
      expect(code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/);
    }
  });

  it('does not include ambiguous characters (0/O/1/I/L)', () => {
    const codes = Array.from({ length: 200 }, () => generateJoinCode()).join(
      ''
    );
    expect(codes).not.toMatch(/[01OIL]/);
  });

  it('is practically unique across draws', () => {
    const seen = new Set(Array.from({ length: 500 }, () => generateJoinCode()));
    expect(seen.size).toBeGreaterThan(495);
  });
});
