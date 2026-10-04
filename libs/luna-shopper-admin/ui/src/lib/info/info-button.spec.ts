import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import type { InfoContent } from '@portfolio/luna-shopper-admin/models';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Viewport } from '../viewport';
import { InfoButton } from './info-button';

const INFO: InfoContent = {
  title: 'catalog.pricePolicies.many',
  points: ['test.info.one', 'test.info.two'],
  caution: 'test.info.caution',
};

async function render(
  compact = false,
  info: InfoContent = INFO
): Promise<ComponentFixture<InfoButton>> {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [InfoButton, RokuTranslatorTestingModule.forTesting()],
    providers: [{ provide: Viewport, useValue: { compact: signal(compact) } }],
  }).compileComponents();

  const fixture = TestBed.createComponent(InfoButton);
  fixture.componentRef.setInput('info', info);
  // In the document, so that focus is real and a press outside has somewhere
  // to land.
  document.body.append(fixture.nativeElement);
  fixture.detectChanges();
  return fixture;
}

const trigger = (fixture: ComponentFixture<InfoButton>) =>
  fixture.nativeElement.querySelector('button.trigger') as HTMLButtonElement;

const panel = (fixture: ComponentFixture<InfoButton>) =>
  fixture.nativeElement.querySelector('[role="dialog"]') as HTMLElement | null;

async function open(fixture: ComponentFixture<InfoButton>): Promise<void> {
  trigger(fixture).click();
  fixture.detectChanges();
  await fixture.whenStable();
}

describe('InfoButton', () => {
  let fixture: ComponentFixture<InfoButton>;

  afterEach(() => fixture?.nativeElement.remove());

  /**
   * A page may hold two of them, and "info" twice says nothing to a screen
   * reader. The name is built from the subject.
   */
  it('is a button named after what it explains', async () => {
    fixture = await render();
    const button = trigger(fixture);

    expect(button.getAttribute('aria-label')).toBe('info.about');
    expect(button.getAttribute('aria-haspopup')).toBe('dialog');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(button.textContent?.trim()).toBe('i');
    expect(panel(fixture)).toBeNull();
  });

  it('opens a dialog with the title, the points and the caution', async () => {
    fixture = await render();
    await open(fixture);

    const dialog = panel(fixture);
    const heading = dialog?.querySelector('h2');

    expect(trigger(fixture).getAttribute('aria-expanded')).toBe('true');
    expect(heading?.textContent).toBe('catalog.pricePolicies.many');
    expect(dialog?.getAttribute('aria-labelledby')).toBe(heading?.id);
    expect(
      [...(dialog?.querySelectorAll('li') ?? [])].map((li) => li.textContent)
    ).toEqual(['test.info.one', 'test.info.two']);
    expect(dialog?.querySelector('lib-caution-line')?.textContent).toContain(
      'test.info.caution'
    );
  });

  it('draws no caution where the content has none', async () => {
    fixture = await render(false, { title: 'a', points: ['b'] });
    await open(fixture);

    expect(panel(fixture)?.querySelector('lib-caution-line')).toBeNull();
  });

  it('moves the focus into the dialog when it opens', async () => {
    fixture = await render();
    await open(fixture);

    expect(document.activeElement).toBe(panel(fixture));
  });

  it('closes on Escape and gives the focus back to the button', async () => {
    fixture = await render();
    await open(fixture);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();

    expect(panel(fixture)).toBeNull();
    expect(document.activeElement).toBe(trigger(fixture));
  });

  it('closes on a press outside and gives the focus back to the button', async () => {
    fixture = await render();
    await open(fixture);

    document.body.click();
    fixture.detectChanges();

    expect(panel(fixture)).toBeNull();
    expect(document.activeElement).toBe(trigger(fixture));
  });

  it('stays open on a press inside the panel', async () => {
    fixture = await render();
    await open(fixture);

    panel(fixture)?.querySelector('li')?.click();
    fixture.detectChanges();

    expect(panel(fixture)).not.toBeNull();
  });

  it('closes when the button is pressed again', async () => {
    fixture = await render();
    await open(fixture);

    trigger(fixture).click();
    fixture.detectChanges();

    expect(panel(fixture)).toBeNull();
  });

  /** Every button on a page hears Escape, and a closed one must not take the focus. */
  it('leaves the focus alone on Escape while it is closed', async () => {
    fixture = await render();
    const elsewhere = document.createElement('button');
    document.body.append(elsewhere);
    elsewhere.focus();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(document.activeElement).toBe(elsewhere);
    elsewhere.remove();
  });
});

/**
 * On a wide screen the dialog is a panel the button anchors. On a phone it is
 * a sheet from the bottom edge, with a scrim and a Close button.
 */
describe('InfoButton, the two shapes of its dialog', () => {
  let fixture: ComponentFixture<InfoButton>;

  afterEach(() => fixture?.nativeElement.remove());

  it('is an anchored panel on a wide screen, with no scrim and no Close', async () => {
    fixture = await render(false);
    await open(fixture);

    expect(panel(fixture)?.classList.contains('sheet')).toBe(false);
    expect(fixture.nativeElement.querySelector('.scrim')).toBeNull();
    expect(fixture.nativeElement.querySelector('.close')).toBeNull();
  });

  it('is a sheet on a phone, closed by its button', async () => {
    fixture = await render(true);
    await open(fixture);

    expect(panel(fixture)?.classList.contains('sheet')).toBe(true);

    const close: HTMLButtonElement =
      fixture.nativeElement.querySelector('.close');
    expect(close.textContent?.trim()).toBe('info.close');

    close.click();
    fixture.detectChanges();

    expect(panel(fixture)).toBeNull();
    expect(document.activeElement).toBe(trigger(fixture));
  });

  it('is a sheet on a phone, closed by a press on the scrim', async () => {
    fixture = await render(true);
    await open(fixture);

    (fixture.nativeElement.querySelector('.scrim') as HTMLElement).click();
    fixture.detectChanges();

    expect(panel(fixture)).toBeNull();
  });

  /**
   * No motion other than a 120 ms fade, and none under reduced motion. Read
   * out of the source, because a spec here loads no component styles and jsdom
   * matches no media query.
   */
  it('fades for 120 ms, only where motion is not reduced', () => {
    const source = readFileSync(join(__dirname, 'info-panel.ts'), 'utf8');
    const animations = [...source.matchAll(/animation:\s*([^;]+);/g)].map(
      (found) => found[1]
    );

    expect(animations).toEqual(['appear 120ms ease-out']);
    expect(source).toMatch(
      /@media \(prefers-reduced-motion: no-preference\) \{\s*\.scrim,\s*\.panel \{\s*animation:/
    );
  });
});

/**
 * The sheet is modal and the panel is not. A sheet covers the page behind a
 * scrim, so the focus moves in and stays in. A panel on a wide screen leaves
 * the page in reach, so Tab walks out of it and it closes behind the focus.
 */
describe('InfoButton, the focus in and out of its dialog', () => {
  let fixture: ComponentFixture<InfoButton>;

  afterEach(() => fixture?.nativeElement.remove());

  const tab = (target: Element, shiftKey = false) => {
    const event = new KeyboardEvent('keydown', {
      key: 'Tab',
      shiftKey,
      bubbles: true,
      cancelable: true,
    });
    target.dispatchEvent(event);
    return event;
  };

  it('says the sheet is modal, and the panel is not', async () => {
    fixture = await render(true);
    await open(fixture);
    expect(panel(fixture)?.getAttribute('aria-modal')).toBe('true');
    fixture.nativeElement.remove();

    fixture = await render(false);
    await open(fixture);
    expect(panel(fixture)?.getAttribute('aria-modal')).toBeNull();
  });

  it('keeps Tab inside the sheet, both ways', async () => {
    fixture = await render(true);
    await open(fixture);
    const close: HTMLButtonElement =
      fixture.nativeElement.querySelector('.close');

    // From the sheet itself, Tab goes on to its one control by itself. From
    // that control, which is the last, it comes back to the first.
    close.focus();
    const forward = tab(close);
    expect(forward.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(close);

    const back = tab(close, true);
    expect(back.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(close);
    expect(panel(fixture)).not.toBeNull();
  });

  it('lets Tab leave the panel on a wide screen', async () => {
    fixture = await render(false);
    await open(fixture);

    const event = tab(panel(fixture) as HTMLElement);

    expect(event.defaultPrevented).toBe(false);
  });

  it('closes the panel when the focus leaves it, and lets the focus go', async () => {
    fixture = await render(false);
    await open(fixture);
    const elsewhere = document.createElement('button');
    document.body.append(elsewhere);

    elsewhere.focus();
    fixture.detectChanges();

    expect(panel(fixture)).toBeNull();
    expect(document.activeElement).toBe(elsewhere);
    elsewhere.remove();
  });

  it('stays open while the focus moves between the button and the panel', async () => {
    fixture = await render(false);
    await open(fixture);

    trigger(fixture).focus();
    fixture.detectChanges();
    expect(panel(fixture)).not.toBeNull();

    panel(fixture)?.focus();
    fixture.detectChanges();
    expect(panel(fixture)).not.toBeNull();
  });

  it('does not close the sheet when the focus leaves it', async () => {
    fixture = await render(true);
    await open(fixture);
    const elsewhere = document.createElement('button');
    document.body.append(elsewhere);

    elsewhere.focus();
    fixture.detectChanges();

    expect(panel(fixture)).not.toBeNull();
    elsewhere.remove();
  });
});

/**
 * The dialog is drawn in the top layer and placed from the rectangle of the
 * button, so that an ancestor that scrolls cannot clip it and an ancestor with
 * a transform cannot move the sheet off the window.
 */
describe('InfoButton, where its dialog is drawn', () => {
  let fixture: ComponentFixture<InfoButton>;

  afterEach(() => fixture?.nativeElement.remove());

  it('makes the panel a popover, and the scrim of the sheet as well', async () => {
    fixture = await render(false);
    await open(fixture);
    expect(panel(fixture)?.getAttribute('popover')).toBe('manual');
    fixture.nativeElement.remove();

    fixture = await render(true);
    await open(fixture);
    expect(panel(fixture)?.getAttribute('popover')).toBe('manual');
    expect(
      fixture.nativeElement.querySelector('.scrim').getAttribute('popover')
    ).toBe('manual');
  });

  it('shows it in the top layer where the browser can', async () => {
    const shown: Element[] = [];
    const prototype = HTMLElement.prototype as unknown as {
      showPopover?: () => void;
    };
    const before = prototype.showPopover;
    prototype.showPopover = function (this: Element) {
      shown.push(this);
    };

    try {
      fixture = await render(true);
      await open(fixture);

      // The scrim first, so that the sheet is above it.
      expect(shown.map((element) => element.className)).toEqual([
        'scrim',
        expect.stringContaining('panel'),
      ]);
    } finally {
      prototype.showPopover = before;
    }
  });

  it('places the panel from the rectangle of the button, inside the window', async () => {
    fixture = await render(false);
    const button = trigger(fixture);
    button.getBoundingClientRect = () =>
      ({ top: 10, bottom: 46, left: 900, right: 936 }) as DOMRect;
    await open(fixture);

    const dialog = panel(fixture) as HTMLElement;

    // Under the button, 8 px below it. jsdom lays nothing out, so the panel
    // has no width and its end edge is the end edge of the button.
    expect(dialog.style.top).toBe('54px');
    expect(dialog.style.left).toBe('936px');
  });

  it('keeps a panel that would leave the window inside it', async () => {
    fixture = await render(false);
    trigger(fixture).getBoundingClientRect = () =>
      ({ top: 10, bottom: 46, left: -40, right: -4 }) as DOMRect;
    await open(fixture);

    expect((panel(fixture) as HTMLElement).style.left).toBe('8px');
  });

  it('leaves the sheet to the bottom edge of the window', async () => {
    fixture = await render(true);
    await open(fixture);

    const dialog = panel(fixture) as HTMLElement;

    expect(dialog.style.top).toBe('');
    expect(dialog.style.left).toBe('');
  });

  it('is fixed to the window and never laid out inside the button', () => {
    const source = readFileSync(join(__dirname, 'info-panel.ts'), 'utf8');

    expect(source).toMatch(/\n {4}\.panel \{\s*position: fixed;/);
    expect(source).not.toMatch(/position: absolute/);
  });
});
