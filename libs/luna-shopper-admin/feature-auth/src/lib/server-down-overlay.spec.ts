import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import {
  ServerReachability,
  SessionStore,
} from '@portfolio/luna-shopper-admin/data-access';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ServerDownOverlay } from './server-down-overlay';

/**
 * The cover over an absent gateway (plan 0008, sections 4 and 9).
 *
 * Zoneless, so promise chains are drained by hand rather than with `whenStable`,
 * which hangs. The translator double returns the key, so copy is asserted by key
 * and never by rendered sentence: the double does not interpolate, and the
 * retry count is interpolated.
 *
 * The reachability service is a double. What is under test is what the cover
 * draws for a given state, and the state machine that produces those states has
 * its own spec.
 */

const state = {
  checking: signal(false),
  attemptsLeft: signal(10),
  exhausted: signal(false),
  signedIn: signal(true),
  retries: 0,
};

const drain = async () => {
  for (let i = 0; i < 6; i += 1) {
    await Promise.resolve();
  }
};

async function render(): Promise<ComponentFixture<ServerDownOverlay>> {
  TestBed.resetTestingModule();

  await TestBed.configureTestingModule({
    imports: [ServerDownOverlay, RokuTranslatorTestingModule.forTesting()],
    providers: [
      provideZonelessChangeDetection(),
      {
        provide: ServerReachability,
        useValue: {
          down: signal(true).asReadonly(),
          checking: state.checking.asReadonly(),
          automaticAttemptsLeft: state.attemptsLeft.asReadonly(),
          exhausted: state.exhausted.asReadonly(),
          retry: async () => {
            state.retries += 1;
            return false;
          },
        },
      },
      {
        provide: SessionStore,
        useValue: { signedIn: () => state.signedIn() },
      },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(ServerDownOverlay);
  fixture.detectChanges();
  return fixture;
}

function text(fixture: ComponentFixture<ServerDownOverlay>): string {
  return (fixture.nativeElement as HTMLElement).textContent ?? '';
}

describe('ServerDownOverlay', () => {
  beforeEach(() => {
    state.checking.set(false);
    state.attemptsLeft.set(10);
    state.exhausted.set(false);
    state.signedIn.set(true);
    state.retries = 0;
  });

  it('says what happened', async () => {
    const fixture = await render();

    expect(text(fixture)).toContain('serverDown.heading');
    expect(text(fixture)).toContain('serverDown.body');
  });

  /**
   * There is nothing to type against a server that cannot check it, and a
   * password field that fails on submit is worse than no field at all.
   */
  it('asks for nothing', async () => {
    const fixture = await render();
    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelectorAll('input')).toHaveLength(0);
  });

  /**
   * Reloading is the one act available to somebody looking at a stuck page that
   * throws away everything this cover protects.
   */
  it('warns against reloading while there is a session', async () => {
    const fixture = await render();

    expect(text(fixture)).toContain('serverDown.doNotReload');
  });

  it('says nothing about reloading before sign in', async () => {
    state.signedIn.set(false);
    const fixture = await render();

    expect(text(fixture)).not.toContain('serverDown.doNotReload');
  });

  it('says how many automatic checks are left', async () => {
    const fixture = await render();

    expect(text(fixture)).toContain('serverDown.retriesLeft');
  });

  it('says when the automatic checks have stopped', async () => {
    state.exhausted.set(true);
    const fixture = await render();

    expect(text(fixture)).toContain('serverDown.stopped');
    expect(text(fixture)).not.toContain('serverDown.retriesLeft');
  });

  it('probes when the button is pressed', async () => {
    const fixture = await render();
    const button = (fixture.nativeElement as HTMLElement).querySelector(
      'button'
    ) as HTMLButtonElement;

    button.click();
    await drain();

    expect(state.retries).toBe(1);
  });

  it('refuses a second press while one is in flight', async () => {
    state.checking.set(true);
    const fixture = await render();
    const button = (fixture.nativeElement as HTMLElement).querySelector(
      'button'
    ) as HTMLButtonElement;

    expect(button.disabled).toBe(true);

    button.click();
    await drain();

    expect(state.retries).toBe(0);
  });

  /** The cover is useless if the keyboard is left behind the `inert` page. */
  it('puts the cursor on the one control there is', async () => {
    const fixture = await render();
    const host = fixture.nativeElement as HTMLElement;

    expect(host.ownerDocument.activeElement).toBe(host.querySelector('button'));
  });

  /**
   * The same rule `0003` asserts of its own overlay, and for the same reason. A
   * blur reads as obscured while staying legible to a phone camera and trivially
   * removable in devtools, which is the worst combination: it feels safe and is
   * not. This cover hides a screen that may be left unattended for the whole
   * outage, so it hides it completely.
   */
  describe('opacity', () => {
    const source = readFileSync(
      join(__dirname, 'server-down-overlay.ts'),
      'utf8'
    );
    /** The rule that draws the cover itself, which is the one that matters. */
    const cover = source.match(/:host \{[^}]*\}/)?.[0] ?? '';

    it('covers the whole viewport with a flat colour', () => {
      expect(cover).toContain('background: var(--admin-surface)');
      expect(cover).toContain('inset: 0');
    });

    it.each([
      ['a blur', /backdrop-filter|blur\(/],
      ['a translucent colour', /rgba\(|hsla\(|#[0-9a-f]{8}\b/i],
      ['a see through layer', /opacity/],
    ])('never draws the cover with %s', (_case, forbidden) => {
      expect(cover).not.toMatch(forbidden);
    });

    it('never blurs anything at all', () => {
      expect(source).not.toMatch(/backdrop-filter|blur\(/);
    });
  });
});
