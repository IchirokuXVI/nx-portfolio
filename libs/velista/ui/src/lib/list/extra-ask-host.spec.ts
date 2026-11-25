import {
  ApplicationRef,
  ChangeDetectionStrategy,
  Component,
  inject,
} from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRokuTranslatorTesting } from '@portfolio/localization/rokutranslator-angular';
import type { AbsorbedExtra } from '@portfolio/velista/models';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  EXTRA_ASK_SCROLL_WAIT_MS,
  ExtraAskHost,
  type ExtraAskRequest,
  type ExtraCountOutcome,
} from './extra-ask-host';
import { ExtraAskPopover } from './extra-ask-popover';

/**
 * The shared piece of velista `0208`, target state 10 (spec 10): the "still there"
 * rule, the scroll that brings a control into view and its comment, the waiting
 * for a reel's rest, the answers, and the notices of a count that wrote nothing.
 */
@Component({
  selector: 'lib-host-under-test',
  imports: [ExtraAskPopover],
  providers: [ExtraAskHost],
  template: `
    <div class="area">
      <div class="row"><button class="control" type="button">2</button></div>
      <input class="field" type="text" />
    </div>
    <lib-extra-ask-popover />
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class HostUnderTest {
  readonly host = inject(ExtraAskHost);
}

const EXTRA: AbsorbedExtra = {
  above: 1,
  countable: 1,
  buyers: [{ userId: null }],
};

const box = (top: number, bottom: number) =>
  ({
    top,
    bottom,
    left: 0,
    right: 100,
    width: 100,
    height: bottom - top,
    x: 0,
    y: top,
    toJSON: () => ({}),
  }) as DOMRect;

async function render() {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [HostUnderTest],
    providers: [...provideRokuTranslatorTesting()],
  }).compileComponents();
  const fixture = TestBed.createComponent(HostUnderTest);
  document.body.append(fixture.nativeElement);
  fixture.detectChanges();
  const root = fixture.nativeElement as HTMLElement;
  const area = root.querySelector<HTMLElement>('.area') as HTMLElement;
  const row = root.querySelector<HTMLElement>('.row') as HTMLElement;
  const control = root.querySelector<HTMLElement>('.control') as HTMLElement;
  const field = root.querySelector<HTMLInputElement>('.field') as HTMLElement;
  jest.spyOn(area, 'getBoundingClientRect').mockReturnValue(box(100, 700));
  const rowBox = jest
    .spyOn(row, 'getBoundingClientRect')
    .mockReturnValue(box(300, 360));
  const scrollBy = jest.fn();
  (area as unknown as { scrollBy: jest.Mock }).scrollBy = scrollBy;
  const host = fixture.componentInstance.host;
  host.connect({
    area: () => area,
    readerId: () => null,
    nameOf: () => null,
  });
  return { fixture, host, area, row, control, field, rowBox, scrollBy };
}

function request(
  parts: { control: HTMLElement; row: HTMLElement },
  overrides: Partial<ExtraAskRequest> = {}
): ExtraAskRequest {
  return {
    lineId: 'ln-eggs',
    zoneId: 'z1',
    unit: 'UNIT',
    extra: EXTRA,
    shown: 2,
    origin: () => parts.control,
    keepInSight: () => parts.row,
    count: async () => 'done',
    inFront: () => true,
    ...overrides,
  };
}

const settle = async (fixture: ComponentFixture<HostUnderTest>) => {
  for (let turn = 0; turn < 10; turn += 1) {
    await Promise.resolve();
  }
  fixture.detectChanges();
  await fixture.whenStable();
};

describe('ExtraAskHost (velista 0208, target state 10)', () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('asks at once on a control in sight, with no scroll', async () => {
    const { fixture, host, scrollBy, ...parts } = await render();

    host.ask(request(parts));
    await settle(fixture);

    expect(scrollBy).not.toHaveBeenCalled();
    expect(host.asked()?.shown).toBe(true);
    expect(host.asked()?.quantity).toBe(2);
    expect(host.words()?.question).toContain('list.extra.ask');
    expect(document.querySelector('lib-extra-ask')).not.toBeNull();
  });

  it.each([
    ['disconnected', { origin: () => null }],
    ['not in front', { inFront: () => false }],
    ['no longer the newest answer', { current: () => false }],
    [
      'a report with nothing to count',
      { extra: { above: 2, countable: 0, buyers: [] } },
    ],
  ])('drops a question whose control is %s', async (_what, overrides) => {
    const { fixture, host, scrollBy, ...parts } = await render();

    host.ask(request(parts, overrides as Partial<ExtraAskRequest>));
    await settle(fixture);

    expect(host.asked()).toBeNull();
    expect(scrollBy).not.toHaveBeenCalled();
  });

  it.each([
    ['wholly above the visible area', box(20, 80), -96],
    ['partly below it', box(660, 720), 36],
  ])(
    'scrolls a control %s into view, smoothly, then asks',
    async (_what, at, by) => {
      const { fixture, host, area, rowBox, scrollBy, ...parts } =
        await render();
      rowBox.mockReturnValue(at);
      scrollBy.mockImplementation(() => rowBox.mockReturnValue(box(300, 360)));

      host.ask(request({ ...parts, row: parts.row }));
      expect(scrollBy).toHaveBeenCalledWith({ top: by, behavior: 'smooth' });
      expect(host.asked()?.shown).toBe(false);

      area.dispatchEvent(new Event('scrollend'));
      await settle(fixture);
      expect(host.asked()?.shown).toBe(true);
    }
  );

  it('brings the control itself into view when what stays in sight is taller than the area', async () => {
    const { fixture, host, area, control, rowBox, scrollBy, ...parts } =
      await render();
    rowBox.mockReturnValue(box(0, 800));
    const controlBox = jest
      .spyOn(control, 'getBoundingClientRect')
      .mockReturnValue(box(20, 60));
    scrollBy.mockImplementation(() =>
      controlBox.mockReturnValue(box(300, 340))
    );

    host.ask(request({ ...parts, control }));
    expect(scrollBy).toHaveBeenCalledWith({ top: -96, behavior: 'smooth' });

    area.dispatchEvent(new Event('scrollend'));
    await settle(fixture);
    expect(host.asked()?.shown).toBe(true);
  });

  it('waits no longer than its timeout for a scroll that sends no scrollend', async () => {
    jest.useFakeTimers();
    const { host, rowBox, scrollBy, ...parts } = await render();
    rowBox.mockReturnValue(box(20, 80));
    scrollBy.mockImplementation(() => rowBox.mockReturnValue(box(300, 360)));

    host.ask(request(parts));
    jest.advanceTimersByTime(EXTRA_ASK_SCROLL_WAIT_MS);

    expect(host.asked()?.shown).toBe(true);
  });

  it('scrolls at once under reduced motion and asks in the same turn', async () => {
    const { fixture, host, rowBox, scrollBy, ...parts } = await render();
    (host as unknown as { _reducedMotion: () => boolean })._reducedMotion =
      () => true;
    rowBox.mockReturnValue(box(20, 80));
    scrollBy.mockImplementation(() => rowBox.mockReturnValue(box(300, 360)));

    host.ask(request(parts));

    expect(scrollBy).toHaveBeenCalledWith({ top: -96, behavior: 'instant' });
    expect(host.asked()?.shown).toBe(true);
    await settle(fixture);
  });

  it('never scrolls an area that holds a focused text field: the default stands', async () => {
    const { fixture, host, field, rowBox, scrollBy, ...parts } = await render();
    rowBox.mockReturnValue(box(20, 80));
    field.focus();

    host.ask(request(parts));
    await settle(fixture);

    expect(scrollBy).not.toHaveBeenCalled();
    expect(host.asked()).toBeNull();
  });

  it('asks without taking focus from a field when no scroll is needed', async () => {
    const { fixture, host, field, ...parts } = await render();
    field.focus();

    host.ask(request(parts));
    await settle(fixture);

    expect(host.asked()?.takeFocus).toBe(false);
    expect(document.activeElement).toBe(field);
    expect(host.announcement()).toBe('list.extra.announce');
  });

  it("names the owner's alternative in a comment at the scroll", () => {
    const source = readFileSync(join(__dirname, 'extra-ask-host.ts'), 'utf8')
      .replace(/\s*\/\/\s*/g, ' ')
      .replace(/\s+/g, ' ');
    const at = source.indexOf('area.scrollBy?.(');
    const comment = source.indexOf(
      'ask only when some part of the control is still visible, and otherwise take the default'
    );
    expect(comment).toBeGreaterThan(-1);
    expect(comment).toBeLessThan(at);
  });

  it('waits for a reel at rest, and asks once it is', async () => {
    const { fixture, host, ...parts } = await render();
    let rest = false;

    host.ask(request(parts, { atRest: () => rest }));
    expect(host.asked()).toBeNull();

    rest = true;
    host.rested();
    await settle(fixture);
    expect(host.asked()?.shown).toBe(true);
  });

  it('drops a waiting question when a newer write of the line goes out', async () => {
    const { host, ...parts } = await render();
    let rest = false;
    host.ask(request(parts, { atRest: () => rest }));

    host.dropWaiting('ln-eggs');
    rest = true;
    host.rested();

    expect(host.asked()).toBeNull();
  });

  it('"Still need" sends nothing', async () => {
    const { fixture, host, ...parts } = await render();
    const count = jest.fn(async (): Promise<ExtraCountOutcome> => 'done');
    host.ask(request(parts, { count }));
    await settle(fixture);

    host.answerStillNeed();

    expect(count).not.toHaveBeenCalled();
    expect(host.asked()).toBeNull();
  });

  it.each([
    ['stale', 'list.extra.stale'],
    ['failed', 'list.extra.countFailed'],
  ] as const)(
    "a count that came back %s leaves its notice in the question's place",
    async (outcome, key) => {
      const { fixture, host, control, ...parts } = await render();
      host.ask(request({ control, ...parts }, { count: async () => outcome }));
      await settle(fixture);

      host.answerCount();
      await settle(fixture);
      await settle(fixture);

      expect(host.notice()?.key).toBe(key);
      expect(host.notice()?.origin).toBe(control);
      expect(host.announcement()).toBe(key);
      host.closeNotice();
      expect(host.notice()).toBeNull();
    }
  );

  it('takes the question down when its control is no longer drawn', async () => {
    const { fixture, host, row, ...parts } = await render();
    host.ask(request({ row, ...parts }));
    await settle(fixture);

    // The page's template takes the row away in a render, as a new search does.
    row.remove();
    fixture.componentRef.changeDetectorRef.markForCheck();
    TestBed.inject(ApplicationRef).tick();
    await settle(fixture);

    expect(host.asked()).toBeNull();
  });
});
