import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
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
