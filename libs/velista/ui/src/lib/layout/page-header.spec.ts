import { Component, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideVelistaTesting } from '@portfolio/velista/platform';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PageHeader } from './page-header';
import { PageHeaderAction } from './page-header-action';

/** A page that states every part, as the list page does. */
@Component({
  imports: [PageHeader, PageHeaderAction],
  template: `
    <lib-page-header
      (back)="backs = backs + 1"
      [backLabel]="backLabel()"
      [leading]="leading()"
      [title]="title()"
    >
      <span class="page-icon" pageHeaderIcon>icon</span>
      <ng-container pageHeaderActions>
        @if (hasActions()) {
          <button
            (click)="presses = presses + 1"
            [badge]="count()"
            aria-label="Filter"
            class="filter"
            libPageHeaderAction
            type="button"
          >
            f
          </button>
          <button class="near" kind="text" libPageHeaderAction type="button">
            Near me
          </button>
        }
      </ng-container>
    </lib-page-header>
  `,
})
class Host {
  readonly title = signal('Compra semanal');
  readonly backLabel = signal<string | null>('Back to the group');
  readonly leading = signal<'back' | 'close'>('back');
  readonly hasActions = signal(true);
  readonly count = signal<number | null>(null);
  backs = 0;
  presses = 0;
}

async function render(): Promise<ComponentFixture<Host>> {
  await TestBed.configureTestingModule({
    imports: [Host],
    providers: [provideVelistaTesting()],
  }).compileComponents();

  const fixture = TestBed.createComponent(Host);
  fixture.detectChanges();
  return fixture;
}

function query(fixture: ComponentFixture<Host>, selector: string) {
  return (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(
    selector
  );
}

function queryAll(fixture: ComponentFixture<Host>, selector: string) {
  return Array.from(
    (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>(
      selector
    )
  );
}

/** The stylesheet as written, with comments out, for the rules that are CSS only. */
function stylesheet(): string {
  return readFileSync(join(__dirname, 'page-header.scss'), 'utf8').replace(
    /\/\/.*$/gm,
    ''
  );
}

/** The one page header (velista `0130`). The rule each test holds is in its name. */
describe('PageHeader', () => {
  it('H2: the title is the page’s only h1, inside the header element', async () => {
    const fixture = await render();

    const headings = queryAll(fixture, 'h1');
    expect(headings).toHaveLength(1);
    expect(headings[0].textContent?.trim()).toBe('Compra semanal');
    expect(query(fixture, 'header h1.title')).not.toBeNull();
  });

  it('H2: the title is one line, cut with an ellipsis, at the one size', async () => {
    const title = stylesheet().match(/\.title\s*\{[^}]*\}/)?.[0] ?? '';

    expect(title).toContain('white-space: nowrap');
    expect(title).toContain('text-overflow: ellipsis');
    expect(title).toContain('font-size: var(--app-header-title-size)');
    expect(title).toContain('font-family: var(--app-font-display)');
    expect(title).toContain('letter-spacing: var(--app-tracking-wordmark)');
  });

  it('H1 and H3: one height from the token, and always a bottom border', async () => {
    const header = stylesheet().match(/\.header\s*\{[^}]*\}/)?.[0] ?? '';

    expect(header).toContain(
      'block-size: calc(var(--app-header-height) + var(--app-safe-top))'
    );
    expect(header).toContain(
      'border-block-end: 1px solid var(--app-border-subtle)'
    );
    // Not sticky: a page places it outside its scroller.
    expect(stylesheet()).not.toMatch(/position:\s*sticky/);
  });

  it('H4: with a back label it draws the back control and no icon', async () => {
    const fixture = await render();

    const back = query(fixture, 'button.lead');
    expect(back?.getAttribute('aria-label')).toBe('Back to the group');
    expect(query(fixture, 'button.lead lib-chevron-left-icon')).not.toBeNull();
    expect(query(fixture, '.page-icon')).toBeNull();

    back?.click();
    expect(fixture.componentInstance.backs).toBe(1);
  });

  it('H4: with no back label it draws the icon and no back control', async () => {
    const fixture = await render();
    fixture.componentInstance.backLabel.set(null);
    fixture.detectChanges();

    expect(query(fixture, 'button.lead')).toBeNull();
    expect(query(fixture, '.icon .page-icon')).not.toBeNull();
    // Decoration: the title beside it already names the page.
    expect(query(fixture, '.icon')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('draws the X in the back position for a page that is closed', async () => {
    const fixture = await render();
    fixture.componentInstance.leading.set('close');
    fixture.detectChanges();

    expect(query(fixture, 'button.lead lib-close-icon')).not.toBeNull();
    expect(query(fixture, 'button.lead lib-chevron-left-icon')).toBeNull();

    query(fixture, 'button.lead')?.click();
    expect(fixture.componentInstance.backs).toBe(1);
  });

  it('H5: the actions are projected at the right, and stay the page’s own buttons', async () => {
    const fixture = await render();

    expect(queryAll(fixture, '.actions button')).toHaveLength(2);
    expect(query(fixture, '.actions .near')?.classList).toContain('is-text');

    query(fixture, '.actions .filter')?.click();
    expect(fixture.componentInstance.presses).toBe(1);
  });

  it('H5: an action that is not there leaves the header as it was', async () => {
    const fixture = await render();
    fixture.componentInstance.hasActions.set(false);
    fixture.detectChanges();

    expect(queryAll(fixture, '.actions button')).toHaveLength(0);
    expect(query(fixture, 'header h1.title')).not.toBeNull();
    expect(query(fixture, 'button.lead')).not.toBeNull();
  });

  it('draws an action’s count as a badge that a screen reader skips', async () => {
    const fixture = await render();
    expect(query(fixture, '.filter .badge')).toBeNull();

    fixture.componentInstance.count.set(2);
    fixture.detectChanges();

    const badge = query(fixture, '.filter .badge');
    expect(badge?.textContent?.trim()).toBe('2');
    expect(badge?.getAttribute('aria-hidden')).toBe('true');
    expect(query(fixture, '.filter')?.classList).toContain('is-on');
  });

  it('H6: a new title replaces the old one in the same h1', async () => {
    const fixture = await render();
    fixture.componentInstance.title.set('List');
    fixture.detectChanges();
    const before = query(fixture, 'h1');

    fixture.componentInstance.title.set('Compra semanal');
    fixture.detectChanges();

    expect(query(fixture, 'h1')).toBe(before);
    expect(before?.textContent?.trim()).toBe('Compra semanal');
  });
});
