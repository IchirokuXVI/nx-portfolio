import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import type { ContactGroup } from '@portfolio/velista/models';
import { PeoplePicker, type PeoplePickerToggle } from './people-picker';

/**
 * The people picker (velista `0085`, section 2, test 1).
 *
 * Marta is in both groups under two names, which is the case the picker exists for:
 * one person, drawn twice, chosen once.
 */
const GROUPS: readonly ContactGroup[] = [
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
];

@Component({
  imports: [PeoplePicker],
  template: `
    <lib-people-picker
      (toggled)="onToggled($event)"
      [busy]="busy()"
      [groups]="groups()"
      [hints]="hints()"
      [selected]="selected()"
    />
  `,
})
class Host {
  readonly groups = signal<readonly ContactGroup[]>(GROUPS);
  readonly selected = signal<ReadonlySet<string>>(new Set());
  readonly busy = signal<ReadonlySet<string>>(new Set());
  readonly hints = signal<ReadonlyMap<string, string>>(new Map());
  /** Whether the host applies a toggle, or refuses it as a failed save would. */
  accept = true;
  readonly toggles: PeoplePickerToggle[] = [];

  onToggled(toggle: PeoplePickerToggle): void {
    this.toggles.push(toggle);
    if (!this.accept) {
      return;
    }
    this.selected.update((held) => {
      const next = new Set(held);
      if (toggle.selected) {
        next.add(toggle.userId);
      } else {
        next.delete(toggle.userId);
      }
      return next;
    });
  }
}

async function render() {
  await TestBed.configureTestingModule({
    imports: [Host, RokuTranslatorTestingModule.forTesting()],
  }).compileComponents();

  const fixture = TestBed.createComponent(Host);
  fixture.detectChanges();
  const root = fixture.nativeElement as HTMLElement;

  const boxOf = (name: string) =>
    [...root.querySelectorAll('label.choice')]
      .find(
        (label) => label.querySelector('.name')?.textContent?.trim() === name
      )
      ?.querySelector('input') as HTMLInputElement;

  const tick = (name: string) => {
    const box = boxOf(name);
    box.click();
    fixture.detectChanges();
  };

  return { fixture, root, host: fixture.componentInstance, boxOf, tick };
}

describe('PeoplePicker', () => {
  it('draws one section per group, headed by the group name', async () => {
    const { root } = await render();

    const headings = [...root.querySelectorAll('h3')].map((h) =>
      h.textContent?.trim()
    );
    expect(headings).toEqual(['Flat', 'Home']);

    // Each list is labelled by its heading, so the section is named by its group.
    const section = root.querySelector('section') as HTMLElement;
    const heading = root.querySelector('h3') as HTMLElement;
    expect(section.getAttribute('aria-labelledby')).toBe(heading.id);
  });

  it('labels each checkbox with the person name in that group', async () => {
    const { boxOf } = await render();

    expect(boxOf('Marta G.').closest('label')).not.toBeNull();
    expect(boxOf('Marta').closest('label')).not.toBeNull();
  });

  it('ticks a person in every group once they are ticked in one, with one toggle', async () => {
    const { host, boxOf, tick } = await render();

    tick('Marta');

    expect(host.toggles).toEqual([{ userId: 'u-marta', selected: true }]);
    expect(boxOf('Marta').checked).toBe(true);
    expect(boxOf('Marta G.').checked).toBe(true);
    expect(boxOf('Leo').checked).toBe(false);
  });

  it('puts a refused tick back', async () => {
    // The trap velista 0075 found: a native box flips before `change`, and a refusal
    // that moves no bound value writes nothing back.
    const { host, boxOf, tick } = await render();
    host.accept = false;

    tick('Leo');

    expect(host.toggles).toEqual([{ userId: 'u-leo', selected: true }]);
    expect(boxOf('Leo').checked).toBe(false);
  });

  it('keeps a busy row s checkbox, marks it busy, and emits nothing for it', async () => {
    const { fixture, host, boxOf, tick } = await render();
    host.busy.set(new Set(['u-leo']));
    fixture.detectChanges();

    const box = boxOf('Leo');
    expect(box).toBeTruthy();
    expect(box.closest('li')?.getAttribute('aria-busy')).toBe('true');

    tick('Leo');
    expect(host.toggles).toEqual([]);
    expect(boxOf('Leo').checked).toBe(false);
  });

  it('describes a person with their hint', async () => {
    const { fixture, host, boxOf } = await render();
    host.hints.set(new Map([['u-leo', 'share.people.linkJoined']]));
    fixture.detectChanges();

    const box = boxOf('Leo');
    const hint = document.getElementById(
      box.getAttribute('aria-describedby') ?? ''
    );
    expect(hint?.textContent?.trim()).toBe('share.people.linkJoined');
  });

  it('says share.people.none with no contacts', async () => {
    const { fixture, host, root } = await render();
    host.groups.set([]);
    fixture.detectChanges();

    expect(root.querySelector('.none')?.textContent?.trim()).toBe(
      'share.people.none'
    );
    expect(root.querySelector('input')).toBeNull();
  });
});
