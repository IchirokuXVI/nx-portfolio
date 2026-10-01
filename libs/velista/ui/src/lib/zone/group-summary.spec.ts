import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import type { GroupHeaderVm } from '@portfolio/velista/models';
import { GroupSummary } from './group-summary';

/**
 * Velista `0130`, section 5.1. The group's name left for the page header, and the
 * three things that sat beside it had to go somewhere: the tile went away, the role
 * leads the presence line, and the member count is the Members row's value.
 *
 * The assertions are on keys and on plain numbers. The testing translator returns the
 * key without interpolating, so a sentence could not be told from its neighbour.
 */

function group(overrides: Partial<GroupHeaderVm> = {}): GroupHeaderVm {
  return {
    id: 'z1',
    name: 'Flat 3B',
    role: 'OWNER',
    memberCount: 5,
    online: [],
    joinCode: 'HK7M2QPD',
    isStaff: true,
    isOwner: true,
    pendingRequestCount: 0,
    stale: false,
    ...overrides,
  };
}

async function render(
  vm: GroupHeaderVm
): Promise<ComponentFixture<GroupSummary>> {
  TestBed.resetTestingModule();

  await TestBed.configureTestingModule({
    imports: [GroupSummary, RokuTranslatorTestingModule.forTesting()],
  }).compileComponents();

  const fixture = TestBed.createComponent(GroupSummary);
  fixture.componentRef.setInput('group', vm);
  fixture.detectChanges();

  return fixture;
}

function host(fixture: ComponentFixture<GroupSummary>): HTMLElement {
  return fixture.nativeElement as HTMLElement;
}

/** What the Members row holds, in order, as class names. */
function membersRow(fixture: ComponentFixture<GroupSummary>): string[] {
  const row = host(fixture).querySelector('.action');

  return Array.from(row?.children ?? []).map(
    (child) => child.className || child.tagName.toLowerCase()
  );
}

describe('GroupSummary', () => {
  describe('what the page header took', () => {
    it('draws no heading and no header of its own', async () => {
      // The page header holds the page's one `h1`, and it is the one `<header>`.
      const fixture = await render(group());

      expect(host(fixture).querySelector('h1')).toBeNull();
      expect(host(fixture).querySelector('header')).toBeNull();
    });

    it('does not repeat the name, and draws no initial tile', async () => {
      const fixture = await render(group({ name: 'Flat 3B' }));

      expect(host(fixture).textContent).not.toContain('Flat 3B');
      expect(host(fixture).querySelector('.tile')).toBeNull();
    });
  });

  describe('the first line', () => {
    it('leads with the role, before who is here', async () => {
      const fixture = await render(group({ role: 'ADMIN', online: ['Ana'] }));

      const line = host(fixture).querySelector('.summary > :first-child');

      expect(line?.classList.contains('here')).toBe(true);
      expect(line?.firstElementChild?.tagName).toBe('LIB-ROLE-CHIP');
      expect(line?.firstElementChild?.textContent).toContain('zone.role.admin');
      expect(line?.lastElementChild?.tagName).toBe('LIB-PRESENCE-ROW');
      expect(line?.lastElementChild?.textContent).toContain(
        'home.presence.here'
      );
    });

    it('still shows the role when nobody is here', async () => {
      const fixture = await render(group({ role: 'MEMBER', online: [] }));

      const line = host(fixture).querySelector('.here');

      expect(line?.querySelector('lib-role-chip')?.textContent).toContain(
        'zone.role.member'
      );
      // The presence row draws nothing for nobody, and takes its own box with it.
      expect(
        line?.querySelector('lib-presence-row')?.classList.contains('empty')
      ).toBe(true);
      expect(line?.querySelector('lib-presence-row')?.textContent?.trim()).toBe(
        ''
      );
    });
  });

  describe('the Members row', () => {
    it('shows the member count as its value, then the chevron', async () => {
      const fixture = await render(
        group({ memberCount: 5, pendingRequestCount: 0 })
      );

      expect(
        host(fixture).querySelector('.action-value')?.textContent?.trim()
      ).toBe('5');
      expect(membersRow(fixture)).toEqual([
        'action-glyph',
        'action-label',
        'action-value',
        'action-chevron',
      ]);
    });

    it('puts the waiting pip between the count and the chevron', async () => {
      const fixture = await render(
        group({ memberCount: 5, pendingRequestCount: 3 })
      );

      expect(host(fixture).querySelector('.pip')?.textContent?.trim()).toBe(
        '3'
      );
      expect(membersRow(fixture)).toEqual([
        'action-glyph',
        'action-label',
        'action-value',
        'pip',
        'action-chevron',
      ]);
    });

    // Read aloud, the row's content is "Members 5 3". The name says which is which.
    it('is named in words: how many members, and how many are waiting', async () => {
      const fixture = await render(
        group({ memberCount: 5, pendingRequestCount: 3 })
      );

      expect(
        host(fixture).querySelector('.action')?.getAttribute('aria-label')
      ).toBe('home.zone.members, zone.detail.waiting');
    });

    it('names only the members when nobody is waiting, or the queue is not theirs', async () => {
      for (const pendingRequestCount of [0, null]) {
        const fixture = await render(group({ pendingRequestCount }));

        expect(
          host(fixture).querySelector('.action')?.getAttribute('aria-label')
        ).toBe('home.zone.members');
      }
    });

    it('draws no pip for a caller who may not see the queue', async () => {
      const fixture = await render(group({ pendingRequestCount: null }));

      expect(host(fixture).querySelector('.pip')).toBeNull();
    });

    it('opens the members', async () => {
      const fixture = await render(group());
      let opened = 0;
      fixture.componentInstance.openMembers.subscribe(() => opened++);

      host(fixture).querySelector<HTMLButtonElement>('.action')?.click();

      expect(opened).toBe(1);
    });
  });

  describe('the settings row, and rule G2', () => {
    it('is offered to staff, and opens the settings', async () => {
      const fixture = await render(group({ isStaff: true }));
      let opened = 0;
      fixture.componentInstance.openSettings.subscribe(() => opened++);

      const rows = host(fixture).querySelectorAll<HTMLButtonElement>('.action');
      rows[1]?.click();

      expect(rows).toHaveLength(2);
      expect(rows[1].textContent).toContain('zone.detail.settings');
      expect(opened).toBe(1);
    });

    it('is absent for a member, whatever the count says', async () => {
      const fixture = await render(
        group({ isStaff: false, pendingRequestCount: 3 })
      );

      expect(host(fixture).querySelectorAll('.action')).toHaveLength(1);
    });
  });

  describe('the stale notice', () => {
    it('says the group is not live', async () => {
      const fixture = await render(group({ stale: true }));

      expect(host(fixture).querySelector('.stale')?.textContent).toContain(
        'zone.detail.stale'
      );
    });

    it('is absent while it is live', async () => {
      const fixture = await render(group({ stale: false }));

      expect(host(fixture).querySelector('.stale')).toBeNull();
    });
  });
});
