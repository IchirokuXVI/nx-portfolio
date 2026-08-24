import {
  buildPage,
  clampPageSize,
  decodeCursor,
  DEFAULT_PAGE_SIZE,
  encodeCursor,
  MAX_PAGE_SIZE,
} from './cursor';

describe('cursor pagination', () => {
  it('clamps the page size into range', () => {
    expect(clampPageSize(undefined)).toBe(DEFAULT_PAGE_SIZE);
    expect(clampPageSize(0)).toBe(DEFAULT_PAGE_SIZE);
    expect(clampPageSize(5)).toBe(5);
    expect(clampPageSize(9999)).toBe(MAX_PAGE_SIZE);
  });

  it('round trips an opaque cursor', () => {
    const token = encodeCursor({ id: '42', order: 'created_at' });
    expect(token).not.toContain('{');
    expect(decodeCursor(token)).toEqual({ id: '42', order: 'created_at' });
  });

  it('treats a missing or malformed cursor as the beginning', () => {
    expect(decodeCursor(undefined)).toBeUndefined();
    expect(decodeCursor('!!!not-base64!!!')).toBeUndefined();
  });

  it('emits nextCursor only when more rows remain', () => {
    const withMore = buildPage([{ id: 'a' }, { id: 'b' }], true, (last) =>
      encodeCursor({ id: last.id })
    );
    expect(withMore.nextCursor).toBe(encodeCursor({ id: 'b' }));

    const atEnd = buildPage([{ id: 'a' }], false, (last) =>
      encodeCursor({ id: last.id })
    );
    expect(atEnd.nextCursor).toBeNull();
  });
});
