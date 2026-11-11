import { Component } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { DRAG_RELEASE_PX, DragReleasesField } from './drag-releases-field';

@Component({
  imports: [DragReleasesField],
  template: `
    <main (dragged)="drags = drags + 1" libDragReleasesField>
      <p class="row">A row</p>
      <div class="cdk-overlay-pane"><button class="option">Pick</button></div>
    </main>
  `,
})
class Host {
  drags = 0;
}

/** Every event the spec sent, so none of them can be found prevented afterwards. */
let sent: Event[] = [];

/** A pointer event jsdom will construct, since it has no `PointerEvent`. */
function pointer(
  type: string,
  x: number,
  y: number,
  pointerType: 'touch' | 'pen' | 'mouse' = 'touch',
  options: { pointerId?: number; isPrimary?: boolean } = {}
): Event {
  const event = new MouseEvent(type, {
    clientX: x,
    clientY: y,
    bubbles: true,
    cancelable: true,
  });
  Object.defineProperty(event, 'pointerId', { value: options.pointerId ?? 1 });
  Object.defineProperty(event, 'pointerType', { value: pointerType });
  Object.defineProperty(event, 'isPrimary', {
    value: options.isPrimary ?? true,
  });

  return event;
}

/** A touch event jsdom will construct, with the fingers it is given. */
function touch(type: string, points: readonly [number, number][]): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'touches', {
    value: points.map(([clientX, clientY]) => ({ clientX, clientY })),
  });

  return event;
}

async function render(): Promise<ComponentFixture<Host>> {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ imports: [Host] });
  const fixture = TestBed.createComponent(Host);
  fixture.detectChanges();
  // `afterNextRender` adds the listeners.
  await fixture.whenStable();

  return fixture;
}

function send(target: Element, event: Event): void {
  sent.push(event);
  target.dispatchEvent(event);
}

function row(fixture: ComponentFixture<Host>): Element {
  return fixture.nativeElement.querySelector('.row') as Element;
}

/** A touch pointer that goes down at the origin and moves straight up `distance`. */
function drag(target: Element, distance: number, pointerType = 'touch'): void {
  const kind = pointerType as 'touch' | 'pen' | 'mouse';
  send(target, pointer('pointerdown', 0, 100, kind));
  send(target, pointer('pointermove', 0, 100 - distance, kind));
  send(target, pointer('pointerup', 0, 100 - distance, kind));
}

describe('DragReleasesField (velista 0189, section 4)', () => {
  beforeEach(() => {
    sent = [];
  });

  afterEach(() => {
    // The constraint the column's own scroll depends on: nothing is ever prevented.
    expect(sent.filter((event) => event.defaultPrevented)).toEqual([]);
  });

  it('draws the threshold as eight CSS px', () => {
    expect(DRAG_RELEASE_PX).toBe(8);
  });

  it('speaks once for a touch moved 9 px', async () => {
    const fixture = await render();

    drag(row(fixture), 9);

    expect(fixture.componentInstance.drags).toBe(1);
  });

  it('says nothing for a touch moved 8 px, a tap', async () => {
    const fixture = await render();

    drag(row(fixture), 8);

    expect(fixture.componentInstance.drags).toBe(0);
  });

  it('measures the straight line, so a diagonal of 6 by 6 counts', async () => {
    const fixture = await render();

    send(row(fixture), pointer('pointerdown', 0, 0));
    send(row(fixture), pointer('pointermove', 6, 6));

    expect(fixture.componentInstance.drags).toBe(1);
  });

  it('speaks for a pen moved 9 px', async () => {
    const fixture = await render();

    drag(row(fixture), 9, 'pen');

    expect(fixture.componentInstance.drags).toBe(1);
  });

  it('never speaks for a mouse, however far it moves', async () => {
    const fixture = await render();

    drag(row(fixture), 50, 'mouse');

    expect(fixture.componentInstance.drags).toBe(0);
  });

  it('speaks once for a gesture that passes the threshold twice', async () => {
    const fixture = await render();

    send(row(fixture), pointer('pointerdown', 0, 100));
    send(row(fixture), pointer('pointermove', 0, 80));
    send(row(fixture), pointer('pointermove', 0, 40));

    expect(fixture.componentInstance.drags).toBe(1);
  });

  it('speaks again for a second gesture', async () => {
    const fixture = await render();

    drag(row(fixture), 20);
    send(row(fixture), touch('touchend', []));
    drag(row(fixture), 20);

    expect(fixture.componentInstance.drags).toBe(2);
  });

  it('keeps counting with the touch events once the browser cancels the pointer', async () => {
    // The browser took the touch for a scroll: only touch events arrive from here.
    const fixture = await render();

    send(row(fixture), pointer('pointerdown', 0, 100));
    send(row(fixture), touch('touchstart', [[0, 100]]));
    send(row(fixture), pointer('pointercancel', 0, 100));
    send(row(fixture), touch('touchmove', [[0, 60]]));

    expect(fixture.componentInstance.drags).toBe(1);
  });

  it('starts a gesture from a touch alone', async () => {
    const fixture = await render();

    send(row(fixture), touch('touchstart', [[0, 100]]));
    send(row(fixture), touch('touchmove', [[0, 80]]));

    expect(fixture.componentInstance.drags).toBe(1);
  });

  it('clears the gesture on a second finger, which is a pinch', async () => {
    const fixture = await render();

    send(row(fixture), touch('touchstart', [[0, 100]]));
    send(
      row(fixture),
      touch('touchstart', [
        [0, 100],
        [50, 100],
      ])
    );
    send(row(fixture), touch('touchmove', [[0, 40]]));

    expect(fixture.componentInstance.drags).toBe(0);
  });

  it('says nothing for a wheel, a scroll or a key', async () => {
    const fixture = await render();
    const target = row(fixture);

    send(target, new WheelEvent('wheel', { deltaY: 400, bubbles: true }));
    send(target, new Event('scroll', { bubbles: true }));
    send(
      target,
      new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })
    );

    expect(fixture.componentInstance.drags).toBe(0);
  });

  it('ignores a gesture that starts in a popover drawn inside the host', async () => {
    const fixture = await render();
    const option = fixture.nativeElement.querySelector('.option') as Element;

    drag(option, 40);
    send(option, touch('touchstart', [[0, 100]]));
    send(option, touch('touchmove', [[0, 40]]));

    expect(fixture.componentInstance.drags).toBe(0);
  });

  it('ignores a gesture that starts outside the host', async () => {
    const fixture = await render();
    const outside = document.createElement('div');
    document.body.appendChild(outside);

    drag(outside, 40);

    expect(fixture.componentInstance.drags).toBe(0);
    outside.remove();
  });

  it('adds every listener as passive', async () => {
    const added = jest.spyOn(HTMLElement.prototype, 'addEventListener');

    await render();

    const ours = added.mock.calls.filter(([type]) =>
      [
        'pointerdown',
        'pointermove',
        'pointerup',
        'touchstart',
        'touchmove',
        'touchend',
        'touchcancel',
      ].includes(type)
    );
    expect(ours.map(([type]) => type).sort()).toEqual([
      'pointerdown',
      'pointermove',
      'pointerup',
      'touchcancel',
      'touchend',
      'touchmove',
      'touchstart',
    ]);
    for (const [, , options] of ours) {
      expect(options).toEqual({ passive: true });
    }
    added.mockRestore();
  });

  it('takes its listeners away when the host goes', async () => {
    const fixture = await render();
    const host = fixture.nativeElement.querySelector('main') as Element;
    const removed = jest.spyOn(host, 'removeEventListener');

    fixture.destroy();

    expect(removed.mock.calls.map(([type]) => type).sort()).toEqual(
      expect.arrayContaining([
        'pointerdown',
        'pointermove',
        'pointerup',
        'touchcancel',
        'touchend',
        'touchmove',
        'touchstart',
      ])
    );
  });
});
