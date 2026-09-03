import { TestBed } from '@angular/core/testing';
import { GatewayError } from '../errors';
import { ShoppingProfileMemory } from './shopping-profile-memory';

function setUp(): ShoppingProfileMemory {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ providers: [ShoppingProfileMemory] });
  return TestBed.inject(ShoppingProfileMemory);
}

describe('ShoppingProfileMemory', () => {
  it('creates the default profile on the first read, with no name', async () => {
    // The list is never empty, and the name is null rather than the English words: a
    // fake that stored "My profile" would be pretending it knows the caller's language.
    const memory = setUp();

    const profiles = await memory.listProfiles();

    expect(profiles).toHaveLength(1);
    expect(profiles[0].name).toBeNull();
    expect(profiles[0].isDefault).toBe(true);
  });

  it('refuses to delete the last profile', async () => {
    // The page never asks, because with one profile it draws no trash. The fake
    // refuses anyway, so a page that started drawing one fails rather than working.
    const memory = setUp();
    const [only] = await memory.listProfiles();

    await expect(memory.deleteProfile(only.id)).rejects.toBeInstanceOf(
      GatewayError
    );
  });

  it('promotes the oldest remaining when the default is deleted', async () => {
    const memory = setUp();
    const [first] = await memory.listProfiles();
    const second = await memory.createProfile({});

    await memory.deleteProfile(first.id);

    const left = await memory.listProfiles();
    expect(left.map((profile) => profile.id)).toEqual([second.id]);
    expect(left[0].isDefault).toBe(true);
  });

  it('answers not found for a profile that is not yours', async () => {
    // Not forbidden: a profile is private, and telling a stranger an id exists is
    // telling them something.
    const memory = setUp();
    await memory.listProfiles();

    await expect(memory.updateProfile('nope', {})).rejects.toMatchObject({
      code: 'not_found',
    });
  });

  // The postal codes used to be one of these, and are not any more: plan 0058 moved
  // them onto a row at a time surface, so `supermarkets` is the collection the write
  // body still replaces.
  it('replaces a collection rather than merging into it', async () => {
    const memory = setUp();
    const [profile] = await memory.listProfiles();

    await memory.updateProfile(profile.id, {
      supermarkets: [{ supermarketId: 'sm-dia', excluded: true }],
    });
    const cleared = await memory.updateProfile(profile.id, {
      supermarkets: [],
    });

    expect(cleared.chains).toEqual([]);
  });

  it('leaves an absent collection alone', async () => {
    const memory = setUp();
    const [profile] = await memory.listProfiles();
    await memory.addPostalCode(profile.id, { postalCode: '14013' });
    await memory.updateProfile(profile.id, {
      supermarkets: [{ supermarketId: 'sm-dia', excluded: true }],
    });

    const renamed = await memory.updateProfile(profile.id, { name: 'Home' });

    expect(renamed.name).toBe('Home');
    expect(renamed.chains).toHaveLength(1);
    // The row surface writes them, so a body that mentions neither collection cannot
    // reach them either.
    expect(renamed.postalCodes).toHaveLength(1);
  });

  it('reads an emptied name as no name', async () => {
    const memory = setUp();
    const [profile] = await memory.listProfiles();
    await memory.updateProfile(profile.id, { name: 'Home' });

    const cleared = await memory.updateProfile(profile.id, { name: '   ' });

    expect(cleared.name).toBeNull();
  });

  it('keeps a postal code nobody serves, and flags it', async () => {
    const memory = setUp();
    const [profile] = await memory.listProfiles();
    await memory.addPostalCode(profile.id, { postalCode: '05631' });

    const scope = await memory.describeScope(profile.id);

    expect(scope.coverage).toEqual([{ postalCode: '05631', served: false }]);
  });

  describe('postal codes, a row at a time (plan 0058)', () => {
    it('adds a typed code as the user’s own, and brings nothing with it', async () => {
      const memory = setUp();
      const [profile] = await memory.listProfiles();

      const after = await memory.addPostalCode(profile.id, {
        postalCode: '14001',
        label: 'home',
      });

      expect(after.postalCodes).toEqual([
        expect.objectContaining({
          postalCode: '14001',
          label: 'home',
          source: 'TYPED',
        }),
      ]);
    });

    it('brings the neighbours in as ours when asked', async () => {
      const memory = setUp();
      const [profile] = await memory.listProfiles();

      const after = await memory.addPostalCode(profile.id, {
        postalCode: '14001',
        expandNearby: true,
      });

      expect(
        after.postalCodes.map((code) => [code.postalCode, code.source])
      ).toEqual([
        ['14001', 'TYPED'],
        ['14002', 'NEARBY'],
        ['14003', 'NEARBY'],
      ]);
    });

    it('counts only the user’s own codes against the cap', async () => {
      // Derived rows do not occupy it and could not: five codes each pulling in their
      // neighbours is a set nobody sized.
      const memory = setUp();
      const [profile] = await memory.listProfiles();

      await memory.addPostalCode(profile.id, {
        postalCode: '14001',
        expandNearby: true,
      });
      const after = await memory.addPostalCode(profile.id, {
        postalCode: '14010',
        expandNearby: true,
      });

      expect(
        after.postalCodes.filter((code) => code.source !== 'NEARBY')
      ).toHaveLength(2);
      expect(after.postalCodes).toHaveLength(5);
    });

    it('refuses a sixth code of the user’s own', async () => {
      const memory = setUp();
      const [profile] = await memory.listProfiles();

      for (const code of ['14001', '14002', '14003', '14004', '14005']) {
        await memory.addPostalCode(profile.id, { postalCode: code });
      }

      await expect(
        memory.addPostalCode(profile.id, { postalCode: '14006' })
      ).rejects.toMatchObject({ code: 'conflict' });
    });

    it('keeps a dismissed neighbour away when its parent is added again', async () => {
      // A pure recompute would put back the row somebody just dismissed, which is why
      // removing a derived code suppresses it rather than deleting it.
      const memory = setUp();
      const [profile] = await memory.listProfiles();
      await memory.addPostalCode(profile.id, {
        postalCode: '14001',
        expandNearby: true,
      });

      await memory.removePostalCode(profile.id, '14002');
      const after = await memory.addPostalCode(profile.id, {
        postalCode: '14001',
        expandNearby: true,
      });

      expect(after.postalCodes.map((code) => code.postalCode)).toEqual([
        '14001',
        '14003',
      ]);
    });

    it('promotes a derived code that is typed, clearing its suppression', async () => {
      const memory = setUp();
      const [profile] = await memory.listProfiles();
      await memory.addPostalCode(profile.id, {
        postalCode: '14001',
        expandNearby: true,
      });
      await memory.removePostalCode(profile.id, '14002');

      const after = await memory.addPostalCode(profile.id, {
        postalCode: '14002',
      });

      expect(
        after.postalCodes.find((code) => code.postalCode === '14002')?.source
      ).toBe('TYPED');
    });

    it('takes the neighbours with a code of the user’s own', async () => {
      const memory = setUp();
      const [profile] = await memory.listProfiles();
      await memory.addPostalCode(profile.id, {
        postalCode: '14001',
        expandNearby: true,
      });

      const after = await memory.removePostalCode(profile.id, '14001');

      expect(after.postalCodes).toEqual([]);
    });
  });

  describe('resolving a point (plan 0058)', () => {
    it('answers a code, and keeps no coordinates anywhere', async () => {
      const memory = setUp();
      const [profile] = await memory.listProfiles();

      const answer = await memory.resolvePostalCode(37.88, -4.78);

      expect(answer).toEqual({ country: 'es', postalCode: '14001' });
      // The point wrote nothing: the profile is exactly as it was, which is the whole
      // of section 3.3 in the form a spec can state it.
      const [after] = await memory.listProfiles();
      expect(after.postalCodes).toEqual([]);
      expect(after.id).toBe(profile.id);
    });

    it('answers null rather than a confident wrong code', async () => {
      const memory = setUp();
      await memory.listProfiles();

      const answer = await memory.resolvePostalCode(64.13, -21.9);

      expect(answer.postalCode).toBeNull();
    });
  });
});
