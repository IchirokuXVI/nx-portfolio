import {
  ChangeDetectionStrategy,
  Component,
  signal,
  type Type,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Viewport } from '../viewport';
import { QueueFrame } from './queue-frame';

/**
 * The chrome the three decision queues share.
 *
 * The router is stubbed rather than mounted. What is worth asserting about the
 * `view` parameter is that arriving with it opens that view and that the
 * switch writes it back, and both are visible at the edge of the component.
 * Mounting a real router would test `Router` instead.
 */

interface Navigated {
  readonly commands: unknown[];
  readonly extras: Record<string, unknown>;
}

const rows = [
  { id: 'a', label: 'Alpha' },
  { id: 'b', label: 'Beta' },
];

/** A queue with no view of its own and no tool: the plainest frame there is. */
@Component({
  selector: 'lib-queue-frame-host',
  imports: [QueueFrame],
  template: `
    <lib-queue-frame
      (loadMore)="asked.set(asked() + 1)"
      (openRow)="opened.set($event)"
      [busy]="false"
      [canLoadMore]="canLoadMore()"
      [empty]="false"
      [failed]="false"
      [loading]="false"
      [rows]="rows"
      confirmKey="test.confirm"
      emptyKey="test.empty"
      rejectKey="test.reject"
      titleKey="test.title"
    >
      <p class="subject-body">the one in front</p>

      <ng-template #queueLine let-row>
        <span class="label">{{ row.label }}</span>
      </ng-template>
    </lib-queue-frame>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class Host {
  readonly rows = rows;
  readonly canLoadMore = signal(false);
  readonly opened = signal<string | null>(null);
  readonly asked = signal(0);
}

/**
 * Admin plan 0049, targets 6 and 7. The rows were also a list with a checkbox
 * on each one, and a count sat above them. Both are gone: the column beside
 * the open row is the list, and the tab of the queue says how many wait.
 */
describe('the queue frame, with the list view and the count removed', () => {
  it('draws the open row and its bar, and no list of checkboxes', async () => {
    const { element } = await mount(Host);

    expect(element.querySelector('.subject-body')).not.toBeNull();
    expect(element.querySelector('.actions.decide')).not.toBeNull();
    expect(element.querySelector('.rows')).toBeNull();
    expect(element.querySelector('input[type="checkbox"]')).toBeNull();
    expect(element.querySelector('.actions.selection')).toBeNull();
  });

  /** An old link, or a bookmark, that still names the view. */
  it('opens the rows for a link that still says view=list', async () => {
    const { element, frame } = await mount(Host, { view: 'list', split: true });

    expect(frame.extra()).toBeNull();
    expect(element.querySelector('.subject-body')).not.toBeNull();
    expect(element.querySelectorAll('.column button.line')).toHaveLength(2);
    expect(element.querySelector('.rows')).toBeNull();
  });

  it('says no count of rows left and decided', async () => {
    const { element } = await mount(Host, { split: true });

    expect(element.querySelector('.tally')).toBeNull();
    expect(element.textContent).not.toContain('harvest.queue.tally');
  });

  it('draws no view switch for a queue with one view', async () => {
    const { element } = await mount(Host);

    expect(element.querySelector('.views')).toBeNull();
    expect(element.querySelector('[data-view]')).toBeNull();
  });

  /** The row above the queue is hidden when it would hold nothing. */
  it('hides the row above a queue that has no tool and no view of its own', () => {
    expect(frameStyles()).toMatch(
      /header:not\(:has\(\.views\)\):has\(\.tools:empty\) \{ display: none/
    );
  });

  /**
   * An operator reading down the column decides nothing while they read, so
   * the way to more rows is a button, and it says how many are loaded.
   */
  it('offers a load more button under the column only while there is more', async () => {
    const { fixture, element, host } = await mount(Host, { split: true });

    expect(element.querySelector('.column .more')).toBeNull();

    host.canLoadMore.set(true);
    fixture.detectChanges();

    const more = element.querySelector<HTMLButtonElement>('.column .more');
    expect(more?.textContent).toContain('harvest.queue.loadMore');
    more?.click();
    expect(host.asked()).toBe(1);
  });
});

/**
 * Admin plan 0044, target 4. What the frame gained for the Review tab: the
 * split on a wide screen, a view of the queue's own, two more slots, and a
 * decide bar that holds still.
 */

/** A screen that uses everything the frame gained. */
@Component({
  selector: 'lib-queue-frame-wide-host',
  imports: [QueueFrame],
  template: `
    <lib-queue-frame
      (openRow)="opened.set($event)"
      [busy]="false"
      [currentId]="current()"
      [empty]="false"
      [extraViews]="extras"
      [failed]="false"
      [loading]="false"
      [rejectShortKey]="short()"
      [rows]="rows"
      confirmKey="test.confirm"
      emptyKey="test.empty"
      rejectKey="test.reject"
      titleKey="test.title"
    >
      <p class="subject-body">the one in front</p>

      <button class="tool" queueTool type="button">a tool</button>
      <button class="other-act" queueAction type="button">another way</button>

      <ng-template #queueLine let-row>
        <span class="line-label">{{ row.label }}</span>
      </ng-template>

      <div class="grouped" queueExtra>grouped by chain</div>
    </lib-queue-frame>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class WideHost {
  readonly rows = rows;
  readonly extras = [{ id: 'groups', labelKey: 'test.groups' }];
  readonly current = signal<string | null>('b');
  readonly short = signal<string | null>(null);
  readonly opened = signal<string | null>(null);
}

async function mount<T>(
  host: Type<T>,
  options: { view?: string; split?: boolean } = {}
) {
  const navigations: Navigated[] = [];
  const split = signal(options.split ?? false);

  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [host, RokuTranslatorTestingModule.forTesting()],
    providers: [
      { provide: Viewport, useValue: { split, compact: signal(false) } },
      {
        provide: ActivatedRoute,
        useValue: {
          snapshot: {
            queryParamMap: convertToParamMap(
              options.view === undefined ? {} : { view: options.view }
            ),
          },
        },
      },
      {
        provide: Router,
        useValue: {
          navigate: async (
            commands: unknown[],
            extras: Record<string, unknown>
          ) => {
            navigations.push({ commands, extras });
            return true;
          },
        },
      },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(host);
  fixture.detectChanges();

  const element = fixture.nativeElement as HTMLElement;
  const frame = fixture.debugElement.query(
    (node) => node.componentInstance instanceof QueueFrame
  ).componentInstance as QueueFrame;

  return {
    fixture,
    element,
    frame,
    navigations,
    split,
    host: fixture.componentInstance,
  };
}

/**
 * The frame's own rules, as the source states them.
 *
 * Read from the file: jest drops a component's styles, and jsdom resolves no
 * `var()` in any case, so what can be asserted is the rule as written.
 */
const frameStyles = (): string => {
  const source = readFileSync(join(__dirname, 'queue-frame.ts'), 'utf8');
  return source.slice(source.indexOf('styles: `')).replace(/\s+/g, ' ');
};

describe('the queue frame split', () => {
  it('draws no column below the split width', async () => {
    const { element } = await mount(WideHost);

    expect(element.querySelector('.column')).toBeNull();
    expect(element.querySelector('.review.split')).toBeNull();
    expect(element.querySelector('.subject-body')).not.toBeNull();
  });

  it('draws the rows as a column beside the open row at the split width', async () => {
    const { element, frame } = await mount(WideHost, { split: true });

    // The column is the queue drawn beside the row, and not a view of it.
    expect(frame.extra()).toBeNull();
    expect(element.querySelector('.review.split')).not.toBeNull();
    expect(element.querySelectorAll('.column button.line')).toHaveLength(2);
    expect(element.querySelector('.card .subject-body')).not.toBeNull();
  });

  it('follows the width while the screen is open', async () => {
    const { fixture, element, split } = await mount(WideHost);

    split.set(true);
    fixture.detectChanges();
    expect(element.querySelectorAll('.column button.line')).toHaveLength(2);

    split.set(false);
    fixture.detectChanges();
    expect(element.querySelector('.column')).toBeNull();
  });

  it('marks the row that is open, and no other', async () => {
    const { fixture, element, host } = await mount(WideHost, { split: true });

    const lines = () => [
      ...element.querySelectorAll<HTMLButtonElement>('.column button.line'),
    ];

    expect(lines().map((line) => line.getAttribute('aria-current'))).toEqual([
      null,
      'true',
    ]);
    expect(lines()[1].classList.contains('open')).toBe(true);

    host.current.set('a');
    fixture.detectChanges();

    expect(lines().map((line) => line.getAttribute('aria-current'))).toEqual([
      'true',
      null,
    ]);
  });

  it('says which row was pressed, and stays in the same view', async () => {
    const { element, host, frame, navigations } = await mount(WideHost, {
      split: true,
    });

    element
      .querySelectorAll<HTMLButtonElement>('.column button.line')[0]
      .click();

    expect(host.opened()).toBe('a');
    expect(frame.extra()).toBeNull();
    expect(navigations).toHaveLength(0);
  });

  it('draws a line with the template the screen gave', async () => {
    const { element } = await mount(WideHost, { split: true });

    const line = element.querySelector('.column button.line');
    expect(line?.querySelector('.line-label')?.textContent).toBe('Alpha');
  });

  /**
   * Admin plan 0049, target 5. A press on a line says which row, and the
   * frame draws the lines in the order it was given: it holds no order of
   * its own to change.
   */
  it('keeps every line in its place when another row is opened', async () => {
    const { fixture, element, host } = await mount(WideHost, { split: true });
    const labels = () =>
      [...element.querySelectorAll('.column .line-label')].map(
        (label) => label.textContent
      );

    expect(labels()).toEqual(['Alpha', 'Beta']);

    host.current.set('a');
    fixture.detectChanges();
    host.current.set('b');
    fixture.detectChanges();

    expect(labels()).toEqual(['Alpha', 'Beta']);
  });
});

describe('the queue frame own views', () => {
  it('adds an entry to the switch for each view the queue names', async () => {
    const { element, frame } = await mount(WideHost);

    const views = [
      ...element.querySelectorAll<HTMLButtonElement>('.views button'),
    ].map((button) => button.dataset['view']);

    expect(views).toEqual(['review', 'groups']);
    expect(frame.extra()).toBeNull();
    // Projected content has one place, so it is hidden and not removed.
    expect(element.querySelector<HTMLElement>('.extra')?.hidden).toBe(true);
  });

  it('shows the queue own view when the URL names it, in place of the rows', async () => {
    const { element, frame } = await mount(WideHost, { view: 'groups' });

    expect(frame.extra()?.id).toBe('groups');
    expect(element.querySelector<HTMLElement>('.extra')?.hidden).toBe(false);
    expect(element.querySelector('.extra .grouped')).not.toBeNull();
    expect(element.querySelector('.subject-body')).toBeNull();
    expect(element.querySelector('.rows')).toBeNull();
    expect(element.querySelector('.actions')).toBeNull();

    const pressed = [
      ...element.querySelectorAll<HTMLButtonElement>('.views button'),
    ].map((button) => button.getAttribute('aria-pressed'));
    expect(pressed).toEqual(['false', 'true']);
  });

  it('writes the parameter when its entry is pressed, and back again', async () => {
    const { fixture, element, frame, navigations } = await mount(WideHost);

    element
      .querySelector<HTMLButtonElement>('.views [data-view="groups"]')
      ?.click();
    fixture.detectChanges();

    expect(frame.extra()?.id).toBe('groups');
    expect(navigations[0].extras).toMatchObject({
      queryParams: { view: 'groups' },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });

    element
      .querySelector<HTMLButtonElement>('.views [data-view="review"]')
      ?.click();
    fixture.detectChanges();

    expect(frame.extra()).toBeNull();
    expect(element.querySelector('.subject-body')).not.toBeNull();
  });

  it('reads a view no queue named as the rows', async () => {
    const { element, frame } = await mount(Host, { view: 'groups' });

    expect(frame.extra()).toBeNull();
    expect(element.querySelector('.subject-body')).not.toBeNull();
  });
});

describe('the queue frame slots', () => {
  it('puts a tool of the queue in the row above it, beside the view switch', async () => {
    const { element } = await mount(WideHost);

    expect(element.querySelector('header .tools .tool')).not.toBeNull();
  });

  it('puts the other actions in the decide bar', async () => {
    const { element } = await mount(WideHost);

    expect(
      element.querySelector('.actions.decide .other .other-act')
    ).not.toBeNull();
  });
});

describe('the queue frame decide bar', () => {
  /**
   * Accept first and reject last, with the other ways and skip between. The
   * order is the DOM's, so a keyboard walks it the way it reads.
   */
  it('holds accept, the other actions, skip and reject, in that order', async () => {
    const { element } = await mount(WideHost);

    const bar = element.querySelector('.actions.decide');
    const order = [...(bar?.children ?? [])].map(
      (child) =>
        (child as HTMLElement).dataset['action'] ??
        (child.classList.contains('other')
          ? 'other'
          : child.classList.contains('grow')
            ? 'grow'
            : child.tagName)
    );

    expect(order).toEqual(['confirm', 'other', 'grow', 'skip', 'reject']);
  });

  /** The two differ in shape as well as in color. */
  it('fills accept and outlines reject', async () => {
    const { element } = await mount(WideHost);
    const styles = frameStyles();

    expect(
      element.querySelector('[data-action="confirm"]')?.classList
    ).toContain('primary');
    expect(
      element.querySelector('[data-action="reject"]')?.classList
    ).toContain('danger');
    expect(styles).toMatch(
      /\.actions \.primary \{[^}]*background: var\(--admin-accent\)/
    );
    expect(styles).toMatch(
      /\.actions \.danger \{[^}]*border-color: var\(--admin-danger\)[^}]*background: var\(--admin-surface-raised\)/
    );
  });

  it('draws no reject for a queue that has no such action', async () => {
    @Component({
      selector: 'lib-queue-frame-no-reject-host',
      imports: [QueueFrame],
      template: `
        <lib-queue-frame
          [busy]="false"
          [empty]="false"
          [failed]="false"
          [loading]="false"
          confirmKey="test.confirm"
          emptyKey="test.empty"
          titleKey="test.title"
        />
      `,
      changeDetection: ChangeDetectionStrategy.OnPush,
    })
    class NoReject {}

    const { element } = await mount(NoReject);

    expect(element.querySelector('[data-action="reject"]')).toBeNull();
    expect(element.querySelector('[data-action="skip"]')).not.toBeNull();
  });

  /**
   * A row that cannot be refused keeps the button, disabled. Without it Skip
   * moved into the slot, and two quick presses on Skip could refuse the next
   * row.
   */
  it('keeps reject in its slot, disabled, for a row that has no such action', async () => {
    @Component({
      selector: 'lib-queue-frame-reject-disabled-host',
      imports: [QueueFrame],
      template: `
        <lib-queue-frame
          (reject)="rejected.set(rejected() + 1)"
          [busy]="false"
          [empty]="false"
          [failed]="false"
          [loading]="false"
          [rejectDisabled]="disabled()"
          confirmKey="test.confirm"
          emptyKey="test.empty"
          rejectKey="test.reject"
          titleKey="test.title"
        />
      `,
      changeDetection: ChangeDetectionStrategy.OnPush,
    })
    class RejectDisabled {
      readonly disabled = signal(true);
      readonly rejected = signal(0);
    }

    const { fixture, element, host } = await mount(RejectDisabled);
    const order = () =>
      [...(element.querySelector('.actions.decide')?.children ?? [])]
        .map((child) => (child as HTMLElement).dataset['action'])
        .filter((action) => action !== undefined);
    const reject = () =>
      element.querySelector<HTMLButtonElement>('[data-action="reject"]');

    expect(order()).toEqual(['confirm', 'skip', 'reject']);
    expect(reject()?.disabled).toBe(true);
    reject()?.click();
    expect(host.rejected()).toBe(0);

    host.disabled.set(false);
    fixture.detectChanges();

    // The same three, in the same places.
    expect(order()).toEqual(['confirm', 'skip', 'reject']);
    expect(reject()?.disabled).toBe(false);
    reject()?.click();
    expect(host.rejected()).toBe(1);
  });

  /**
   * Three buttons share one row on a phone, so reject may carry a shorter
   * name there. The long name stays the accessible one.
   */
  it('gives reject a short name for a phone and keeps the long one as its name', async () => {
    const { fixture, element, host } = await mount(WideHost);

    const reject = () =>
      element.querySelector<HTMLButtonElement>('[data-action="reject"]');

    expect(reject()?.getAttribute('aria-label')).toBe('test.reject');
    expect(reject()?.querySelector('.long')?.textContent).toBe('test.reject');
    expect(reject()?.querySelector('.short')?.textContent).toBe('test.reject');

    host.short.set('test.rejectShort');
    fixture.detectChanges();

    expect(reject()?.getAttribute('aria-label')).toBe('test.reject');
    expect(reject()?.querySelector('.long')?.textContent).toBe('test.reject');
    expect(reject()?.querySelector('.short')?.textContent).toBe(
      'test.rejectShort'
    );
  });

  /**
   * The bar sticks to the bottom edge of the window on a wide screen, so the
   * buttons are where they were when the next row comes up.
   */
  it('sticks to the bottom edge of the window', () => {
    expect(frameStyles()).toMatch(
      /\.actions \{[^}]*position: sticky;[^}]*inset-block-end: var\(--admin-page-block\)/
    );
  });

  /**
   * On a phone the bar is fixed above the navigation bar and never under it:
   * it starts where the navigation ends, and the frame reserves its height.
   */
  it('is fixed above the navigation bar on a phone', () => {
    const styles = frameStyles();
    const phone = styles.slice(styles.indexOf('@media (max-width: 47.99rem)'));

    expect(phone).toMatch(
      /\.actions \{[^}]*position: fixed;[^}]*inset-block-end: var\(--admin-bar\)/
    );
    expect(phone).not.toMatch(/inset-block-end: 0[;\s]/);
    expect(phone).toMatch(/:host \{[^}]*padding-block-end: 4\.5rem/);
  });

  /** Reject, skip, then accept, which takes the room that is left. */
  it('orders the three on a phone and hides the other actions there', () => {
    const styles = frameStyles();
    const phone = styles.slice(styles.indexOf('@media (max-width: 47.99rem)'));

    expect(phone).toMatch(/\.actions\.decide \.danger \{ order: 1/);
    expect(phone).toMatch(/\.actions\.decide \.skip \{ order: 2/);
    expect(phone).toMatch(/\.actions\.decide \.primary \{ flex: 1; order: 3/);
    expect(phone).toMatch(/\.actions\.decide \.other,[^{]*\{ display: none/);
  });
});
