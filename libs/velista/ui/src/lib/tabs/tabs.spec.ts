import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import { tabElementId, tabPanelId, Tabs, type TabItem } from './tabs';

/** `lib-tabs` (velista `0085`, section 5, test 4). */
const TABS: readonly TabItem[] = [
  { id: 'mine', labelKey: 'history.tabs.mine' },
  { id: 'shared', labelKey: 'history.tabs.shared' },
  { id: 'third', labelKey: 'third' },
];

@Component({
  imports: [Tabs],
  template: `
    <lib-tabs
      (selectedChange)="onChange($event)"
      [selected]="selected()"
      [tabs]="tabs"
      idPrefix="t"
      labelKey="history.title"
    />
  `,
})
class Host {
  readonly tabs = TABS;
  readonly selected = signal('mine');
  readonly changes: string[] = [];

  onChange(id: string): void {
    this.changes.push(id);
    this.selected.set(id);
  }
}

async function render() {
  await TestBed.configureTestingModule({
    imports: [Host, RokuTranslatorTestingModule.forTesting()],
  }).compileComponents();

  const fixture = TestBed.createComponent(Host);
  // Attached, so focus moves are real.
  document.body.appendChild(fixture.nativeElement);
  fixture.detectChanges();
  const root = fixture.nativeElement as HTMLElement;
  const tabs = () => [...root.querySelectorAll<HTMLElement>('[role="tab"]')];
  const press = (target: HTMLElement, key: string) => {
    target.dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
    );
    fixture.detectChanges();
  };

  return { fixture, root, host: fixture.componentInstance, tabs, press };
}

describe('Tabs', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('is a tablist of tabs, each controlling its panel', async () => {
    const { root, tabs } = await render();

    expect(root.querySelector('[role="tablist"]')).not.toBeNull();
    const [mine] = tabs();
    expect(mine.id).toBe(tabElementId('t', 'mine'));
    expect(mine.getAttribute('aria-controls')).toBe(tabPanelId('t', 'mine'));
    expect(mine.getAttribute('aria-selected')).toBe('true');
    expect(tabs()[1].getAttribute('aria-selected')).toBe('false');
  });

  it('keeps one tab in the tab order, the selected one', async () => {
    const { tabs } = await render();

    expect(tabs().map((tab) => tab.getAttribute('tabindex'))).toEqual([
      '0',
      '-1',
      '-1',
    ]);
  });

  it('moves focus with the arrow keys, wrapping, without selecting', async () => {
    const { host, tabs, press } = await render();
    tabs()[0].focus();

    press(tabs()[0], 'ArrowRight');
    expect(document.activeElement).toBe(tabs()[1]);
    expect(tabs()[1].getAttribute('tabindex')).toBe('0');
    expect(tabs()[0].getAttribute('tabindex')).toBe('-1');

    press(tabs()[1], 'ArrowLeft');
    press(tabs()[0], 'ArrowLeft');
    expect(document.activeElement).toBe(tabs()[2]);

    expect(host.changes).toEqual([]);
  });

  it('moves to the first and last tab with Home and End', async () => {
    const { tabs, press } = await render();
    tabs()[1].focus();

    press(tabs()[1], 'End');
    expect(document.activeElement).toBe(tabs()[2]);

    press(tabs()[2], 'Home');
    expect(document.activeElement).toBe(tabs()[0]);
  });

  it('selects on Enter, on Space and on a tap', async () => {
    const { host, tabs, press, fixture } = await render();

    press(tabs()[1], 'Enter');
    expect(host.changes).toEqual(['shared']);
    expect(tabs()[1].getAttribute('aria-selected')).toBe('true');

    press(tabs()[2], ' ');
    expect(host.changes).toEqual(['shared', 'third']);

    tabs()[0].click();
    fixture.detectChanges();
    expect(host.changes).toEqual(['shared', 'third', 'mine']);
  });

  it('does not emit for the tab already selected', async () => {
    const { host, tabs, fixture } = await render();

    tabs()[0].click();
    fixture.detectChanges();

    expect(host.changes).toEqual([]);
  });
});
