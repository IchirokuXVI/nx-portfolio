import { groupContacts, type Contact } from './contacts';

/** Grouping the flat memberships for the picker (velista `0085`, section 2). */
describe('groupContacts', () => {
  const names = new Map([
    ['z-home', 'Home'],
    ['z-flat', 'Flat'],
  ]);

  it('draws one section per group, both levels sorted for reading', () => {
    const contacts: Contact[] = [
      { userId: 'u-marta', zoneId: 'z-home', username: 'Marta' },
      { userId: 'u-leo', zoneId: 'z-home', username: 'Leo' },
      { userId: 'u-marta', zoneId: 'z-flat', username: 'Marta G.' },
    ];

    expect(groupContacts(contacts, names, 'en')).toEqual([
      {
        zoneId: 'z-flat',
        zoneName: 'Flat',
        people: [{ userId: 'u-marta', username: 'Marta G.' }],
      },
      {
        zoneId: 'z-home',
        zoneName: 'Home',
        people: [
          { userId: 'u-leo', username: 'Leo' },
          { userId: 'u-marta', username: 'Marta' },
        ],
      },
    ]);
  });

  it('leaves out a group it cannot name', () => {
    const contacts: Contact[] = [
      { userId: 'u-leo', zoneId: 'z-gone', username: 'Leo' },
    ];

    expect(groupContacts(contacts, names, 'en')).toEqual([]);
  });

  it('draws a person repeated across a page boundary once', () => {
    const contacts: Contact[] = [
      { userId: 'u-leo', zoneId: 'z-home', username: 'Leo' },
      { userId: 'u-leo', zoneId: 'z-home', username: 'Leo' },
    ];

    expect(groupContacts(contacts, names, 'en')[0]?.people).toHaveLength(1);
  });

  it('still sorts under a locale tag Intl does not know', () => {
    const contacts: Contact[] = [
      { userId: 'b', zoneId: 'z-home', username: 'Bea' },
      { userId: 'a', zoneId: 'z-home', username: 'Ana' },
    ];

    expect(
      groupContacts(contacts, names, 'not a tag')[0]?.people.map(
        (person) => person.username
      )
    ).toEqual(['Ana', 'Bea']);
  });
});
