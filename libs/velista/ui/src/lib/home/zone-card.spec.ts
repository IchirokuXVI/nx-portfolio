import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import type { ZoneCardVm, ZoneRole } from '@portfolio/velista/models';
import { provideVelistaTesting } from '@portfolio/velista/platform';
import { ZoneCard } from './zone-card';

function card(overrides: Partial<ZoneCardVm> = {}): ZoneCardVm {
  return {
    id: 'z1',
    name: 'Flat 3B',
    initial: 'F',
    role: 'MEMBER',
    membership: 'APPROVED',
    memberCount: 3,
    listCount: 2,
    lists: [],
    online: [],
    tappable: true,
    ...overrides,
  };
}

async function render(
  zone: ZoneCardVm = card()
): Promise<ComponentFixture<ZoneCard>> {
  TestBed.resetTestingModule();

  await TestBed.configureTestingModule({
    imports: [ZoneCard, RokuTranslatorTestingModule.forTesting()],
    providers: [provideVelistaTesting()],
  }).compileComponents();

  const fixture = TestBed.createComponent(ZoneCard);
  fixture.componentRef.setInput('zone', zone);
  fixture.detectChanges();

  return fixture;
}

/** The classes on the role badge, which is what carries the tint. */
async function badgeClasses(role: ZoneRole): Promise<string[]> {
  const fixture = await render(card({ role }));
  const badge = (fixture.nativeElement as HTMLElement).querySelector('.badge');

  if (badge === null) {
    throw new Error(`no role badge was drawn for ${role}`);
  }

  return Array.from(badge.classList).sort();
}

describe('ZoneCard', () => {
  describe('the role badge', () => {
    // Plan 0020, section 4. The card drew Admin and Member as the same grey chip with
    // different text, because `.badge-admin` did not exist. That is the observation the
    // "a promotion changes nothing on screen" report was actually made from: the role
    // did move, live and correctly, and the card had no way to show that it had.
    //
    // Asserted on the classes rather than on the computed colour, because jsdom does
    // not apply the stylesheet and the tokens live in `zone-card.scss`. What the three
    // branches have to be is *distinct*, which the class is enough to prove.

    it('tints an admin apart from an ordinary member', async () => {
      const admin = await badgeClasses('ADMIN');
      const member = await badgeClasses('MEMBER');

      expect(admin).toContain('badge-admin');
      expect(member).not.toContain('badge-admin');
      expect(admin).not.toEqual(member);
    });

    it('gives each of the three roles its own badge', async () => {
      const [owner, admin, member] = await Promise.all([
        badgeClasses('OWNER'),
        badgeClasses('ADMIN'),
        badgeClasses('MEMBER'),
      ]);

      expect(new Set([owner, admin, member].map((c) => c.join(' '))).size).toBe(
        3
      );
    });

    it('names the role in words as well as in colour', async () => {
      // **Never colour alone** (plan 0002, section 11). The tint is the second signal,
      // never the only one.
      const fixture = await render(card({ role: 'ADMIN' }));
      const badge = (fixture.nativeElement as HTMLElement).querySelector(
        '.badge'
      );

      expect(badge?.textContent).toContain('zone.role.admin');
    });

    it('draws the pending badge instead of a role while still waiting', async () => {
      const fixture = await render(
        card({ membership: 'PENDING', role: 'MEMBER', tappable: false })
      );
      const badges = (fixture.nativeElement as HTMLElement).querySelectorAll(
        '.badge'
      );

      expect(badges).toHaveLength(1);
      expect(badges[0].classList).toContain('badge-pending');
    });
  });
});
