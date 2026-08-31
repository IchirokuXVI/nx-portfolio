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

  it('replaces a collection rather than merging into it', async () => {
    const memory = setUp();
    const [profile] = await memory.listProfiles();

    await memory.updateProfile(profile.id, {
      postalCodes: [{ postalCode: '14013', label: 'home' }],
    });
    const cleared = await memory.updateProfile(profile.id, {
      postalCodes: [],
    });

    expect(cleared.postalCodes).toEqual([]);
  });

  it('leaves an absent collection alone', async () => {
    const memory = setUp();
    const [profile] = await memory.listProfiles();
    await memory.updateProfile(profile.id, {
      postalCodes: [{ postalCode: '14013', label: null }],
    });

    const renamed = await memory.updateProfile(profile.id, { name: 'Home' });

    expect(renamed.name).toBe('Home');
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
    await memory.updateProfile(profile.id, {
      postalCodes: [{ postalCode: '05631', label: null }],
    });

    const scope = await memory.describeScope(profile.id);

    expect(scope.coverage).toEqual([{ postalCode: '05631', served: false }]);
  });
});
