import { TestBed } from '@angular/core/testing';
import { RESOURCE_GATEWAYS } from '../resource/resource-gateways';
import { ADMIN_NAMES_SOURCE, AdminNames, adminNamesOf } from './admin-names';

/**
 * Who an admin id is, for the harvest pages (admin plan 0074, section 2).
 *
 * The answer is read from `unknown`. Whatever the gateway sends, a name is
 * drawn only where the row holds one, and nothing throws.
 */

function reader(list: () => Promise<unknown>): AdminNames {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      AdminNames,
      {
        provide: RESOURCE_GATEWAYS,
        useValue: { for: () => ({ list }) },
      },
    ],
  });
  return TestBed.inject(AdminNames);
}

describe('ADMIN_NAMES_SOURCE', () => {
  const page = (body: unknown) =>
    ADMIN_NAMES_SOURCE.page?.(body) ?? { items: [], nextCursor: null };

  it('reads the admins out of `{ admins }`', () => {
    expect(page({ admins: [{ adminId: 'a1' }, 'stray'] }).items).toEqual([
      { adminId: 'a1' },
    ]);
  });

  it('answers no rows for a body with no `admins` array', () => {
    expect(page({ items: [] }).items).toEqual([]);
    expect(page(null).items).toEqual([]);
    expect(page({ admins: 'everyone' }).items).toEqual([]);
  });
});

describe('adminNamesOf', () => {
  it('names an admin by display name, else by username', () => {
    const names = adminNamesOf([
      { adminId: 'a1', username: 'ichiroku', displayName: 'Ichiroku' },
      { adminId: 'a2', username: 'retired', displayName: null },
      { adminId: 'a3', username: 'blank', displayName: '  ' },
    ]);

    expect(names.get('a1')).toBe('Ichiroku');
    expect(names.get('a2')).toBe('retired');
    expect(names.get('a3')).toBe('blank');
  });

  it('leaves out a row with no id, or with no name at all', () => {
    const names = adminNamesOf([
      { username: 'nobody' },
      { adminId: 42, username: 'numbered' },
      { adminId: 'a4' },
      null,
    ]);

    expect(names.size).toBe(0);
  });
});

describe('AdminNames', () => {
  it('answers null for every id until it is loaded', () => {
    const names = reader(async () => ({
      items: [{ adminId: 'a1', username: 'one' }],
      nextCursor: null,
    }));

    expect(names.state()).toBe('idle');
    expect(names.nameOf('a1')).toBeNull();
  });

  it('names the admins it read', async () => {
    const names = reader(async () => ({
      items: [{ adminId: 'a1', username: 'one', displayName: 'One' }],
      nextCursor: null,
    }));

    await names.load();

    expect(names.state()).toBe('ready');
    expect(names.nameOf('a1')).toBe('One');
    expect(names.nameOf('a2')).toBeNull();
  });

  it('answers null for a row with no adminId', async () => {
    const names = reader(async () => ({
      items: [{ username: 'one' }],
      nextCursor: null,
    }));

    await names.load();

    expect(names.nameOf('one')).toBeNull();
  });

  it('answers null for every id after a failed read, and does not ask again', async () => {
    const list = jest.fn(async () => {
      throw new Error('refused');
    });
    const names = reader(list);

    await expect(names.load()).resolves.toBeUndefined();
    await names.load();

    expect(names.state()).toBe('failed');
    expect(names.nameOf('a1')).toBeNull();
    expect(list).toHaveBeenCalledTimes(1);
  });

  it('reads the list once however often it is asked', async () => {
    const list = jest.fn(async () => ({ items: [], nextCursor: null }));
    const names = reader(list);

    await Promise.all([names.load(), names.load()]);
    await names.load();

    expect(list).toHaveBeenCalledTimes(1);
  });

  it('names the admins of the memory back end with no server', async () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [AdminNames] });
    const names = TestBed.inject(AdminNames);

    await names.load();

    expect(names.nameOf('admin-ichiroku')).toBe('Ichiroku');
    expect(names.nameOf('admin-retired')).toBe('retired');
  });
});
