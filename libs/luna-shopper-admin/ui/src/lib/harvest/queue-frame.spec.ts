import {
  ChangeDetectionStrategy,
  Component,
  signal,
  type Type,
} from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Viewport } from '../viewport';
import { QueueFrame, type QueueReport } from './queue-frame';

/**
 * Plan 0020, section 7. The frame's own half of the plan: the toggle, the two
 * bars in one place, and what the selection bar looks like while a run is going.
 *
 * The router is stubbed rather than mounted. The two properties worth asserting
 * are that arriving with `view=list` opens the list and that toggling writes the
 * parameter back, and both are visible at the edge of the component. Mounting a
 * real router would test `Router` instead.
 */

interface Navigated {
  readonly commands: unknown[];
  readonly extras: Record<string, unknown>;
}

const rows = [
  { id: 'a', label: 'Alpha' },
  { id: 'b', label: 'Beta' },
];

/**
 * A screen around the frame, which is the only way to reach it.
 *
 * The row template and the bulk buttons are the screen's, by design: the frame
 * owns the checkbox column and the bar's position, and the columns in between
 * are per screen because the rows are.
 */
@Component({
  selector: 'lib-queue-frame-host',
  imports: [QueueFrame],
  template: `
    <lib-queue-frame
      (openRow)="opened.set($event)"
      (pickRow)="ticked.set($event)"
      [busy]="false"
      [canLoadMore]="canLoadMore()"
      [decided]="1"
      [defaultView]="defaultView()"
      [empty]="false"
      [failed]="false"
      [loading]="false"
      [progress]="progress()"
      [remaining]="2"
      [report]="report()"
      [rows]="rows"
      [selected]="selected()"
      [selectedCount]="selected().size"
      confirmKey="test.confirm"
      emptyKey="test.empty"
      progressKey="test.rejecting"
      rejectKey="test.reject"
      titleKey="test.title"
    >
      <p class="subject-body">the one in front</p>

      <ng-template #queueRow let-row>
        <span class="label">{{ row.label }}</span>
      </ng-template>

      <button class="bulk-reject" queueBulk type="button">reject them</button>
    </lib-queue-frame>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class Host {
  readonly rows = rows;
  readonly defaultView = signal<'review' | 'list'>('review');
  readonly selected = signal<ReadonlySet<string>>(new Set<string>());
  readonly progress = signal<{ done: number; total: number } | null>(null);
  readonly report = signal<QueueReport | null>(null);
  readonly canLoadMore = signal(false);

  readonly ticked = signal<string | null>(null);
  readonly opened = signal<string | null>(null);
}

async function render(view?: string) {
  const navigations: Navigated[] = [];

  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [Host, RokuTranslatorTestingModule.forTesting()],
    providers: [
      {
        provide: ActivatedRoute,
        useValue: {
          snapshot: {
            queryParamMap: convertToParamMap(
              view === undefined ? {} : { view }
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

  const fixture = TestBed.createComponent(Host);
  fixture.detectChanges();

  return { fixture, navigations, host: fixture.componentInstance };
}

const frameOf = (fixture: ComponentFixture<Host>): QueueFrame =>
  fixture.debugElement.query(
    (node) => node.componentInstance instanceof QueueFrame
  ).componentInstance as QueueFrame;

const html = (fixture: ComponentFixture<Host>): HTMLElement =>
  fixture.nativeElement as HTMLElement;

describe('the queue frame view toggle', () => {
  it('opens in the view the screen states when the URL names none', async () => {
    const { fixture } = await render();

    expect(frameOf(fixture).view()).toBe('review');
    expect(html(fixture).querySelector('.subject-body')).not.toBeNull();
    expect(html(fixture).querySelector('.rows')).toBeNull();
  });

  /** A reload keeps it, and a link carries it. That is the whole reason it is a
   * query parameter rather than storage. */
  it('opens in the view the URL names, whatever the screen states', async () => {
    const { fixture } = await render('list');

    expect(frameOf(fixture).view()).toBe('list');
    expect(html(fixture).querySelectorAll('.rows li')).toHaveLength(2);
  });

  it('ignores a view the URL invented', async () => {
    const { fixture } = await render('sideways');

    expect(frameOf(fixture).view()).toBe('review');
  });

  it('honours each screen own default', async () => {
    const { fixture, host } = await render();

    host.defaultView.set('list');
    fixture.detectChanges();

    expect(frameOf(fixture).view()).toBe('list');
  });

  it('writes the parameter when the toggle is pressed', async () => {
    const { fixture, navigations } = await render();

    const toggles =
      html(fixture).querySelectorAll<HTMLButtonElement>('.views button');
    toggles[1].click();
    fixture.detectChanges();

    expect(frameOf(fixture).view()).toBe('list');
    expect(navigations).toHaveLength(1);
    expect(navigations[0].extras).toMatchObject({
      queryParams: { view: 'list' },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  });
});

describe('the queue frame two bars', () => {
  /**
   * Same place on the screen, same size, same reachability by thumb. The fixed
   * position is one rule over `.actions`, so both bars carrying that class is
   * what makes them the same place rather than two rules that agree today.
   */
  it('puts the action bar and the selection bar in the same position', async () => {
    const review = await render();
    const list = await render('list');

    const reviewBar = html(review.fixture).querySelector('.actions');
    const listBar = html(list.fixture).querySelector('.actions');

    expect(reviewBar).not.toBeNull();
    expect(listBar).not.toBeNull();
    expect(listBar?.classList.contains('actions')).toBe(true);
    // The review bar decides; the selection bar acts on a selection. Neither
    // shows while the other does.
    expect(reviewBar?.textContent).toContain('test.confirm');
    expect(listBar?.textContent).toContain('harvest.queue.selectAll');
  });

  it('offers the screen own bulk buttons in the selection bar', async () => {
    const { fixture } = await render('list');

    expect(html(fixture).querySelector('.actions .bulk-reject')).not.toBeNull();
  });

  /**
   * A progress line counting rows and not time, in place of the buttons. A bar
   * that still offered "reject" while rejecting would invite a second run over a
   * selection the first is already draining.
   */
  it('replaces the selection bar buttons with the progress line while a run is in flight', async () => {
    const { fixture, host } = await render('list');

    host.progress.set({ done: 42, total: 200 });
    fixture.detectChanges();

    const bar = html(fixture).querySelector('.actions');
    expect(bar?.textContent).toContain('test.rejecting');
    expect(bar?.textContent).toContain('harvest.queue.bulk.stop');
    expect(bar?.textContent).not.toContain('harvest.queue.selectAll');
    expect(html(fixture).querySelector('.bulk-reject')).toBeNull();
  });
});

describe('the queue frame list view', () => {
  it('draws one row per item, with the screen own columns and a checkbox', async () => {
    const { fixture } = await render('list');

    const items = html(fixture).querySelectorAll('.rows li');
    expect(items).toHaveLength(2);
    expect(items[0].querySelector('input[type="checkbox"]')).not.toBeNull();
    expect(items[0].querySelector('.label')?.textContent).toBe('Alpha');
  });

  it('ticks a row without deciding it', async () => {
    const { fixture, host } = await render('list');

    html(fixture).querySelectorAll<HTMLInputElement>('.rows input')[1].click();

    expect(host.ticked()).toBe('b');
    expect(host.opened()).toBeNull();
  });

  /**
   * A list whose rows cannot be examined pushes every hard case into a decision
   * made from four columns.
   */
  it('opens a clicked row in the review view', async () => {
    const { fixture, host } = await render('list');

    html(fixture)
      .querySelectorAll<HTMLButtonElement>('.rows .cells')[1]
      .click();
    fixture.detectChanges();

    expect(host.opened()).toBe('b');
    expect(frameOf(fixture).view()).toBe('review');
  });

  it('shows the selected rows as selected', async () => {
    const { fixture, host } = await render('list');

    host.selected.set(new Set(['b']));
    fixture.detectChanges();

    const items = html(fixture).querySelectorAll('.rows li');
    expect(items[0].classList.contains('picked')).toBe(false);
    expect(items[1].classList.contains('picked')).toBe(true);
  });

  /**
   * There is no decision in a list view to trigger the queue's own prefetch, so
   * the way to more rows is a button, and it says how many are loaded.
   */
  it('offers a load more button only while there is more', async () => {
    const { fixture, host } = await render('list');

    expect(html(fixture).querySelector('.more')).toBeNull();

    host.canLoadMore.set(true);
    fixture.detectChanges();

    expect(html(fixture).querySelector('.more')?.textContent).toContain(
      'harvest.queue.loadMore'
    );
  });
});

describe('the queue frame bulk report', () => {
  const report: QueueReport = {
    done: 3,
    total: 3,
    succeeded: 1,
    stopped: false,
    failed: [
      { name: 'Ronda del Marrubial', reasonKey: 'resource.error.conflict' },
    ],
    skipped: [{ name: 'Centro Comercial Zahira', reasonKey: '' }],
  };

  /**
   * Section 6. A bulk that reports one word is a bulk an operator cannot
   * recover from, so every failure is named with its own reason, and the rows
   * that were never attempted are a separate list.
   */
  it('names each refusal and lists what was left alone apart from it', async () => {
    const { fixture, host } = await render('list');

    host.report.set(report);
    fixture.detectChanges();

    const text = html(fixture).querySelector('.report')?.textContent ?? '';
    expect(text).toContain('Ronda del Marrubial');
    expect(text).toContain('resource.error.conflict');
    expect(text).toContain('harvest.queue.bulk.refused');
    expect(text).toContain('Centro Comercial Zahira');
    expect(text).toContain('harvest.queue.bulk.leftAlone');
  });

  it('says what a stopped run did rather than what it was going to do', async () => {
    const { fixture, host } = await render('list');

    host.report.set({ ...report, stopped: true });
    fixture.detectChanges();

    const text = html(fixture).querySelector('.report')?.textContent ?? '';
    expect(text).toContain('harvest.queue.bulk.stopped');
    expect(text).not.toContain('harvest.queue.bulk.finished');
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
      [decided]="0"
      [empty]="false"
      [extraViews]="extras"
      [failed]="false"
      [loading]="false"
      [rejectShortKey]="short()"
      [remaining]="2"
      [rows]="rows"
      confirmKey="test.confirm"
      emptyKey="test.empty"
      rejectKey="test.reject"
      titleKey="test.title"
    >
      <p class="subject-body">the one in front</p>

      <button class="tool" queueTool type="button">a tool</button>
      <button class="other-act" queueAction type="button">another way</button>

      <ng-template #queueRow let-row>
        <span class="label">{{ row.label }}</span>
      </ng-template>
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

    // The same view and the same parameter: the column is the queue drawn
    // beside the row and not a third answer to "which view".
    expect(frame.view()).toBe('review');
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
    expect(frame.view()).toBe('review');
    expect(navigations).toHaveLength(0);
  });

  it('draws a line with the line template where the screen gave one', async () => {
    const { element } = await mount(WideHost, { split: true });

    const line = element.querySelector('.column button.line');
    expect(line?.querySelector('.line-label')?.textContent).toBe('Alpha');
    expect(line?.querySelector('.label')).toBeNull();
  });

  it('falls back to the list row where the screen gave no line template', async () => {
    const { element } = await mount(Host, { split: true });

    const line = element.querySelector('.column button.line');
    expect(line?.querySelector('.label')?.textContent).toBe('Alpha');
  });

  it('keeps the list view a list at the split width', async () => {
    const { element } = await mount(WideHost, { view: 'list', split: true });

    expect(element.querySelector('.column')).toBeNull();
    expect(element.querySelectorAll('.rows li')).toHaveLength(2);
  });
});

describe('the queue frame own views', () => {
  it('adds an entry to the switch for each view the queue names', async () => {
    const { element, frame } = await mount(WideHost);

    const views = [
      ...element.querySelectorAll<HTMLButtonElement>('.views button'),
    ].map((button) => button.dataset['view']);

    expect(views).toEqual(['review', 'list', 'groups']);
    expect(frame.extra()).toBeNull();
    // Projected content has one place, so it is hidden and not removed.
    expect(element.querySelector<HTMLElement>('.extra')?.hidden).toBe(true);
  });

  it('adds none for a queue that names none', async () => {
    const { element } = await mount(Host);

    expect(element.querySelectorAll('.views button')).toHaveLength(2);
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
    expect(pressed).toEqual(['false', 'false', 'true']);
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

  it('reads a view no queue named as the screen own default', async () => {
    const { frame } = await mount(Host, { view: 'groups' });

    expect(frame.extra()).toBeNull();
    expect(frame.view()).toBe('review');
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
          [decided]="0"
          [empty]="false"
          [failed]="false"
          [loading]="false"
          [remaining]="1"
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
          [decided]="0"
          [empty]="false"
          [failed]="false"
          [loading]="false"
          [rejectDisabled]="disabled()"
          [remaining]="1"
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
