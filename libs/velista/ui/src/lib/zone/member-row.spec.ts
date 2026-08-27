import { Component, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import type { MemberAction, MemberRowVm } from '@portfolio/velista/models';
import { MemberRow } from './member-row';

/**
 * Plan 0010 section 7: the row menu is a **menu**.
 *
 * A `<div>` of buttons that looks like a menu is announced as a group of unrelated
 * controls, which on a screen full of near-identical rows is the difference between
 * usable and not. The semantics are therefore asserted rather than assumed.
 */
@Component({
  imports: [MemberRow],
  template: `<lib-member-row (act)="acted.set($event)" [member]="member()" />`,
})
class Host {
  readonly member = signal<MemberRowVm>({
    membershipId: 'm-1',
    userId: 'u-1',
    name: 'Marta',
    initial: 'M',
    role: 'MEMBER',
    isYou: false,
    actions: ['rename', 'remove', 'ban'],
    busy: false,
  });

  readonly acted = signal<{
    action: MemberAction;
    membershipId: string;
  } | null>(null);
}

async function render(
  overrides: Partial<MemberRowVm> = {}
): Promise<ComponentFixture<Host>> {
  TestBed.resetTestingModule();

  await TestBed.configureTestingModule({
    imports: [Host, RokuTranslatorTestingModule.forTesting()],
  }).compileComponents();

  const fixture = TestBed.createComponent(Host);
  fixture.componentInstance.member.update((current) => ({
    ...current,
    ...overrides,
  }));
  fixture.detectChanges();
  await fixture.whenStable();

  return fixture;
}

function el(fixture: ComponentFixture<Host>, selector: string) {
  return (fixture.nativeElement as HTMLElement).querySelector(selector);
}

function openMenu(fixture: ComponentFixture<Host>): void {
  (el(fixture, '.trigger') as HTMLButtonElement).click();
  fixture.detectChanges();
}

describe('MemberRow', () => {
  it('announces the trigger as opening a menu, named for the person', async () => {
    const fixture = await render();
    const trigger = el(fixture, '.trigger');

    expect(trigger?.getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger?.getAttribute('aria-expanded')).toBe('false');
    // Otherwise a screen reader hears "button" repeated down a list of rows.
    expect(trigger?.getAttribute('aria-label')).toContain(
      'zone.members.menuFor'
    );
  });

  it('marks the panel and its items with menu roles', async () => {
    const fixture = await render();
    openMenu(fixture);

    expect(el(fixture, '.trigger')?.getAttribute('aria-expanded')).toBe('true');
    expect(el(fixture, '[role="menu"]')).not.toBeNull();
    expect(
      (fixture.nativeElement as HTMLElement).querySelectorAll(
        '[role="menuitem"]'
      )
    ).toHaveLength(3);
  });

  it('closes on Escape and hands focus back to the trigger', async () => {
    const fixture = await render();
    openMenu(fixture);

    (fixture.nativeElement as HTMLElement)
      .querySelector('lib-member-row')
      ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();

    expect(el(fixture, '[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(el(fixture, '.trigger'));
  });

  it('closes on a click outside and leaves focus where the click landed', async () => {
    // Not `close()`, which would pull focus back to a row the person has finished
    // with. Escape and choosing an item are the two gestures that hand focus back.
    const fixture = await render();
    openMenu(fixture);

    const elsewhere = document.createElement('button');
    document.body.appendChild(elsewhere);
    elsewhere.focus();
    elsewhere.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    fixture.detectChanges();

    expect(el(fixture, '[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(elsewhere);

    elsewhere.remove();
  });

  it('keeps the menu open when the click is the trigger itself', async () => {
    // The trigger is inside the host, so its own click is an inside click and
    // `toggleMenu()` is still the only thing that toggles.
    const fixture = await render();
    openMenu(fixture);

    expect(el(fixture, '[role="menu"]')).not.toBeNull();
  });

  it('emits the chosen action and closes', async () => {
    const fixture = await render();
    openMenu(fixture);

    (
      (fixture.nativeElement as HTMLElement).querySelectorAll(
        '[role="menuitem"]'
      )[1] as HTMLButtonElement
    ).click();
    fixture.detectChanges();

    expect(fixture.componentInstance.acted()).toEqual({
      action: 'remove',
      membershipId: 'm-1',
    });
    expect(el(fixture, '[role="menu"]')).toBeNull();
  });

  it('has no trigger at all when there is nothing the caller may do', async () => {
    // Absent, not disabled. A disabled control says "you could do this, later" about
    // something that will never be permitted (section 5.4).
    const fixture = await render({ actions: [] });

    expect(el(fixture, '.trigger')).toBeNull();
  });

  it('says what a destructive item does in its own words', async () => {
    // Coral is a second signal and never the only one, so the meaning survives a
    // colourblind reader and a screen reader alike (section 7).
    const fixture = await render();
    openMenu(fixture);

    const ban = (fixture.nativeElement as HTMLElement).querySelectorAll(
      '[role="menuitem"]'
    )[2];

    expect(ban?.textContent).toContain('zone.members.ban');
    expect(ban?.classList.contains('destructive')).toBe(true);
  });

  it('marks a row that is writing as busy and keeps its name', async () => {
    const fixture = await render({ busy: true });

    expect(el(fixture, '.row')?.getAttribute('aria-busy')).toBe('true');
    expect(el(fixture, '.name')?.textContent).toContain('Marta');
    expect((el(fixture, '.trigger') as HTMLButtonElement).disabled).toBe(true);
  });

  it('labels your own row so you can find yourself in a long list', async () => {
    const fixture = await render({ isYou: true });

    expect(el(fixture, '.you')?.textContent).toContain('zone.members.you');
  });
});
