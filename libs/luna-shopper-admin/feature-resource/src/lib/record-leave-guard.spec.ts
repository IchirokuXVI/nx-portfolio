import { Component, inject, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import { ContentLocaleStore } from '@portfolio/luna-shopper-admin/data-access';
import {
  defineResource,
  type ResourceGateway,
  type ResourceRow,
} from '@portfolio/luna-shopper-admin/models';
import { Viewport } from '@portfolio/luna-shopper-admin/ui';
import { provideSections } from './admin-section';
import { recordLeaveGuard, type LeaveAware } from './record-leave-guard';
import { RecordPage } from './record-page';
import { resourceFormBranch } from './routes';

/**
 * Leaving a record with changes asks first (admin plan 0053, section 2.6).
 *
 * Through the real router, because the guard is nothing without it: what is
 * asserted is that a navigation waits for the answer, and what each answer
 * does to the address and to the draft.
 */

const gateway: ResourceGateway<ResourceRow> = {
  list: async () => ({ items: [], nextCursor: null }),
  read: async (id) => ({ id, name: `Widget ${id}` }),
  create: async (input) => ({ id: 'w_new', ...input }),
  update: async (id, input) => ({ id, ...input }),
  remove: async () => undefined,
};

const WIDGETS = defineResource<{ id: string; name: string }>({
  name: 'widgets',
  segment: 'widgets',
  labels: { one: 'widgets.one', many: 'widgets.many' },
  title: (row) => row.name,
  fields: [{ kind: 'text', name: 'name', label: 'widgets.name' }],
  list: { columns: ['name'], compact: ['name'] },
  actions: { create: true, edit: true },
  gateway: () => gateway,
});

@Component({ template: 'elsewhere' })
class Elsewhere {}

async function mount(url: string): Promise<RouterTestingHarness> {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [RokuTranslatorTestingModule.forTesting()],
    providers: [
      ContentLocaleStore,
      provideSections({ key: 'stuff', label: '', resources: [WIDGETS] }),
      {
        provide: Viewport,
        useValue: { compact: signal(false), split: signal(false) },
      },
      provideRouter([
        { path: 'widgets', pathMatch: 'full', component: Elsewhere },
        resourceFormBranch(WIDGETS),
        { path: 'elsewhere', component: Elsewhere },
        // A route that cannot be entered: the navigation fails after the
        // operator has answered.
        { path: 'shut', canActivate: [() => false], component: Elsewhere },
        // A route that sends the navigation on, which runs the guards again.
        {
          path: 'moved',
          canActivate: [() => inject(Router).parseUrl('/elsewhere')],
          component: Elsewhere,
        },
      ]),
    ],
  }).compileComponents();

  const harness = await RouterTestingHarness.create(url);
  await drawn(harness);
  return harness;
}

async function drawn(harness: RouterTestingHarness): Promise<void> {
  for (let turn = 0; turn < 3; turn++) {
    harness.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  harness.detectChanges();
}

const pageOf = (harness: RouterTestingHarness): RecordPage =>
  harness.fixture.debugElement.query(By.directive(RecordPage))
    .componentInstance;

const dialog = (harness: RouterTestingHarness) =>
  (harness.fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(
    '[data-leave]'
  );

const url = () => TestBed.inject(Router).url;

/** Open the form of a widget and type into it. */
async function changed(harness: RouterTestingHarness): Promise<RecordPage> {
  const page = pageOf(harness);
  page.edit();
  page.store().set('name', 'Typed and not saved');
  await drawn(harness);
  return page;
}

describe('recordLeaveGuard', () => {
  it('lets a clean page be left at once, reading or as a form', async () => {
    const harness = await mount('/widgets/w1');

    await TestBed.inject(Router).navigateByUrl('/elsewhere');
    expect(url()).toBe('/elsewhere');

    await TestBed.inject(Router).navigateByUrl('/widgets/w1');
    await drawn(harness);
    pageOf(harness).edit();
    await drawn(harness);

    await TestBed.inject(Router).navigateByUrl('/elsewhere');
    expect(url()).toBe('/elsewhere');
    expect(dialog(harness)).toBeNull();
  });

  it('asks when something changed, and the navigation waits for the answer', async () => {
    const harness = await mount('/widgets/w1');
    await changed(harness);

    let settled = false;
    const leaving = TestBed.inject(Router)
      .navigateByUrl('/elsewhere')
      .then((went) => {
        settled = true;
        return went;
      });
    await drawn(harness);

    expect(dialog(harness)).not.toBeNull();
    expect(settled).toBe(false);
    expect(url()).toBe('/widgets/w1');

    dialog(harness)?.querySelector<HTMLElement>('[data-dismiss]')?.click();
    await leaving;
  });

  it('keeps the route and the draft on "Stay here"', async () => {
    const harness = await mount('/widgets/w1');
    const page = await changed(harness);

    const leaving = TestBed.inject(Router).navigateByUrl('/elsewhere');
    await drawn(harness);
    dialog(harness)?.querySelector<HTMLElement>('[data-dismiss]')?.click();

    expect(await leaving).toBe(false);
    await drawn(harness);
    expect(url()).toBe('/widgets/w1');
    expect(pageOf(harness)).toBe(page);
    expect(page.store().mode()).toBe('edit');
    expect(page.store().draft()['name']).toBe('Typed and not saved');
    expect(dialog(harness)).toBeNull();
  });

  it('lets the navigation through on "Leave and lose them"', async () => {
    const harness = await mount('/widgets/w1');
    await changed(harness);

    const leaving = TestBed.inject(Router).navigateByUrl('/elsewhere');
    await drawn(harness);
    dialog(harness)?.querySelector<HTMLElement>('[data-confirm]')?.click();

    expect(await leaving).toBe(true);
    expect(url()).toBe('/elsewhere');
  });

  /**
   * "Leave and lose them" is an answer and not yet a navigation. One that
   * fails afterwards must not have cost the operator what they typed.
   */
  it('keeps the draft when the navigation fails after "Leave and lose them"', async () => {
    const harness = await mount('/widgets/w1');
    const page = await changed(harness);

    const leaving = TestBed.inject(Router).navigateByUrl('/shut');
    await drawn(harness);
    dialog(harness)?.querySelector<HTMLElement>('[data-confirm]')?.click();

    expect(await leaving).toBe(false);
    await drawn(harness);
    expect(url()).toBe('/widgets/w1');
    expect(pageOf(harness)).toBe(page);
    expect(page.store().mode()).toBe('edit');
    expect(page.store().draft()['name']).toBe('Typed and not saved');

    // The yes was for that navigation. The next one asks again.
    const again = TestBed.inject(Router).navigateByUrl('/elsewhere');
    await drawn(harness);
    expect(dialog(harness)).not.toBeNull();
    dialog(harness)?.querySelector<HTMLElement>('[data-dismiss]')?.click();
    expect(await again).toBe(false);
  });

  /** A redirect runs the guard a second time, for the same navigation. */
  it('asks once for a navigation that is sent on to another address', async () => {
    const harness = await mount('/widgets/w1');
    await changed(harness);
    const page = pageOf(harness);
    let asked = 0;
    const ask = page.canLeave.bind(page);
    page.canLeave = () => {
      asked += 1;
      return ask();
    };

    const leaving = TestBed.inject(Router).navigateByUrl('/moved');
    await drawn(harness);
    dialog(harness)?.querySelector<HTMLElement>('[data-confirm]')?.click();
    await leaving;
    await drawn(harness);

    expect(url()).toBe('/elsewhere');
    // The guard ran twice, and the operator was asked one time.
    expect(asked).toBe(2);
    expect(dialog(harness)).toBeNull();
  });

  /**
   * The router keeps the component when only the ID changes. It still runs
   * the guard, so going from one record to the next asks as well.
   */
  it('asks on the way to another record of the same route', async () => {
    const harness = await mount('/widgets/w1');
    const page = await changed(harness);

    const first = TestBed.inject(Router).navigateByUrl('/widgets/w2');
    await drawn(harness);
    expect(dialog(harness)).not.toBeNull();
    dialog(harness)?.querySelector<HTMLElement>('[data-dismiss]')?.click();
    expect(await first).toBe(false);
    expect(page.store().draft()['name']).toBe('Typed and not saved');

    const second = TestBed.inject(Router).navigateByUrl('/widgets/w2');
    await drawn(harness);
    dialog(harness)?.querySelector<HTMLElement>('[data-confirm]')?.click();
    expect(await second).toBe(true);
    await drawn(harness);

    // The page the router kept, reading the other record, with no draft.
    expect(pageOf(harness)).toBe(page);
    expect(page.store().mode()).toBe('read');
    expect(page.store().row()?.['id']).toBe('w2');
  });

  it('asks about a new record that was filled in', async () => {
    const harness = await mount('/widgets/new');
    pageOf(harness).store().set('name', 'Typed and not saved');
    await drawn(harness);

    const leaving = TestBed.inject(Router).navigateByUrl('/elsewhere');
    await drawn(harness);

    expect(dialog(harness)?.querySelector('p')?.textContent).toContain(
      'record.leave.bodyNew'
    );
    dialog(harness)?.querySelector<HTMLElement>('[data-confirm]')?.click();
    expect(await leaving).toBe(true);
  });

  /** A save is on the server: the page that follows it is not asked about. */
  it('asks nothing on the way to the record that was just added', async () => {
    const harness = await mount('/widgets/new');
    const page = pageOf(harness);
    page.store().set('name', 'Saved');
    const row = await page.store().submit();

    page.saved(row as ResourceRow);
    await drawn(harness);

    expect(url()).toBe('/widgets/w_new');
    expect(dialog(harness)).toBeNull();
  });

  /** A second navigation while the question is up does not answer the first. */
  it('answers "stay" to the navigation a second one replaced', async () => {
    const harness = await mount('/widgets/w1');
    await changed(harness);

    const first = TestBed.inject(Router).navigateByUrl('/elsewhere');
    await drawn(harness);
    const second = TestBed.inject(Router).navigateByUrl('/widgets');
    await drawn(harness);

    expect(await first).toBe(false);
    dialog(harness)?.querySelector<HTMLElement>('[data-dismiss]')?.click();
    expect(await second).toBe(false);
    expect(url()).toBe('/widgets/w1');
  });

  it('lets a component that cannot answer be left', () => {
    const run = (component: unknown) =>
      TestBed.runInInjectionContext(() =>
        recordLeaveGuard(
          component as LeaveAware,
          null as never,
          null as never,
          null as never
        )
      );

    expect(run({})).toBe(true);
    expect(run(null)).toBe(true);
    expect(run({ canLeave: () => false })).toBe(false);
  });
});

describe('the question of the browser', () => {
  const listening = () => {
    const held = new Set<EventListenerOrEventListenerObject>();
    const add = jest
      .spyOn(window, 'addEventListener')
      .mockImplementation((type, listener) => {
        if (type === 'beforeunload') {
          held.add(listener);
        }
      });
    const remove = jest
      .spyOn(window, 'removeEventListener')
      .mockImplementation((type, listener) => {
        if (type === 'beforeunload') {
          held.delete(listener);
        }
      });
    return { held, restore: () => (add.mockRestore(), remove.mockRestore()) };
  };

  /** The browser asks before a reload or a closed tab, and only then. */
  it('is there only while something changed', async () => {
    const { held, restore } = listening();
    try {
      const harness = await mount('/widgets/w1');
      const page = pageOf(harness);
      expect(held.size).toBe(0);

      page.edit();
      await drawn(harness);
      expect(held.size).toBe(0);

      page.store().set('name', 'Typed and not saved');
      await drawn(harness);
      expect(held.size).toBe(1);

      // What the handler does is ask: it cancels the unload.
      const event = new Event('beforeunload', { cancelable: true });
      const [handler] = [...held];
      (handler as EventListener)(event);
      expect(event.defaultPrevented).toBe(true);

      page.store().set('name', 'Widget w1');
      await drawn(harness);
      expect(held.size).toBe(0);

      page.store().set('name', 'Typed again');
      await drawn(harness);
      expect(held.size).toBe(1);
      await page.store().submit();
      await drawn(harness);
      expect(held.size).toBe(0);
    } finally {
      restore();
    }
  });

  it('goes with the page', async () => {
    const { held, restore } = listening();
    try {
      const harness = await mount('/widgets/w1');
      await changed(harness);
      expect(held.size).toBe(1);

      const leaving = TestBed.inject(Router).navigateByUrl('/elsewhere');
      await drawn(harness);
      dialog(harness)?.querySelector<HTMLElement>('[data-confirm]')?.click();
      await leaving;
      await drawn(harness);

      expect(held.size).toBe(0);
    } finally {
      restore();
    }
  });
});
