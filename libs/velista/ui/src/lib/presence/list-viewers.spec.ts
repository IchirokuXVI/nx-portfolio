import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import {
  RokuLocaleStore,
  RokuTranslatorTestingModule,
} from '@portfolio/localization/rokutranslator-angular';
import type { ListViewerVm, ZoneRole } from '@portfolio/velista/models';
import { ListViewers } from './list-viewers';

/**
 * The list page's presence row.
 *
 * The rules worth a test are the ones that break quietly: a stack that shows more
 * bubbles than the sentence names, a `+n` that counts something other than the people
 * it is standing in for, and a panel that invents an arrival time for somebody the
 * client has only just seen.
 *
 * The testing translator returns the key rather than interpolating it, so these assert
 * on **which** key was chosen and on the structure around it. Whether the Spanish for
 * it reads well is not something a unit test can know.
 */
function viewer(
  name: string,
  overrides: Partial<ListViewerVm> = {}
): ListViewerVm {
  return {
    userId: `u-${name}`,
    name,
    role: null,
    since: null,
    ...overrides,
  };
}

async function render(
  viewers: readonly ListViewerVm[]
): Promise<ComponentFixture<ListViewers>> {
  TestBed.resetTestingModule();

  await TestBed.configureTestingModule({
    imports: [ListViewers, RokuTranslatorTestingModule.forTesting()],
    providers: [
      { provide: RokuLocaleStore, useValue: { locale: signal('en') } },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(ListViewers);
  fixture.componentRef.setInput('viewers', viewers);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();

  return fixture;
}

function host(fixture: ComponentFixture<ListViewers>): HTMLElement {
  return fixture.nativeElement as HTMLElement;
}

function bubbles(fixture: ComponentFixture<ListViewers>): (string | null)[] {
  return Array.from(host(fixture).querySelectorAll('.row .avatar')).map(
    (avatar) => avatar.textContent?.trim() ?? null
  );
}

function open(fixture: ComponentFixture<ListViewers>): void {
  host(fixture).querySelector<HTMLButtonElement>('.disclose')?.click();
  fixture.detectChanges();
}

describe('ListViewers', () => {
  describe('nobody is here', () => {
    // Never "0 on the list", never a greyed out placeholder. Presence under reports by
    // design, so a zero is the one number it must not assert, and this is also what the
    // header shows before the first broadcast and the instant the socket drops.
    it('draws nothing at all, and takes its own box with it', async () => {
      const fixture = await render([]);

      expect(host(fixture).querySelector('.row')).toBeNull();
      expect(host(fixture).classList).toContain('empty');
    });
  });

  describe('the sentence and the stack agree', () => {
    it('names one person, with one bubble', async () => {
      const fixture = await render([viewer('Ana')]);

      expect(bubbles(fixture)).toEqual(['A']);
      expect(host(fixture).textContent).toContain('list.presence.one');
    });

    it('names both of two, with two bubbles', async () => {
      const fixture = await render([viewer('Ana'), viewer('Marc')]);

      expect(bubbles(fixture)).toEqual(['A', 'M']);
      expect(host(fixture).textContent).toContain('list.presence.two');
    });

    // The whole point of the collapsed form: one bubble and a `+n` where `n` is exactly
    // the number the sentence says is not named. Two bubbles over "and 2 more" would be
    // two different answers to one question.
    it('shows one bubble and a count once there are more than two', async () => {
      const fixture = await render([
        viewer('Ana'),
        viewer('Marc'),
        viewer('Ines'),
      ]);

      expect(bubbles(fixture)).toEqual(['A', '+2']);
      expect(host(fixture).textContent).toContain('list.presence.more');
    });

    it('keeps the two agreeing as the crowd grows', async () => {
      const fixture = await render([
        viewer('Ana'),
        viewer('Marc'),
        viewer('Ines'),
        viewer('Toni'),
        viewer('Sam'),
      ]);

      expect(bubbles(fixture)).toEqual(['A', '+4']);
    });

    // Slicing cuts a surrogate pair in half and a name starting with an emoji would
    // draw the replacement character. Every initial in this app is a code point.
    it('takes an initial as a code point', async () => {
      const fixture = await render([viewer('\u{1F600}na')]);

      expect(bubbles(fixture)).toEqual(['\u{1F600}']);
    });

    // Presence changes with nobody touching the screen, so it is announced politely
    // rather than silently swapped.
    it('announces itself politely', async () => {
      const fixture = await render([viewer('Ana')]);

      expect(
        host(fixture).querySelector('.sentence')?.getAttribute('aria-live')
      ).toBe('polite');
    });
  });

  describe('the panel', () => {
    it('is closed until the arrow is pressed', async () => {
      const fixture = await render([viewer('Ana')]);

      expect(host(fixture).querySelector('.people')).toBeNull();
      expect(
        host(fixture).querySelector('.disclose')?.getAttribute('aria-expanded')
      ).toBe('false');
    });

    // Everybody, including the ones the sentence collapsed into a number: the panel is
    // the answer to "who are the other four", so a panel that also collapsed them
    // would leave the question unanswerable.
    it('lists every one of them, not only the named ones', async () => {
      const fixture = await render([
        viewer('Ana'),
        viewer('Marc'),
        viewer('Ines'),
      ]);
      open(fixture);

      expect(
        Array.from(host(fixture).querySelectorAll('.person-name')).map(
          (name) => name.textContent
        )
      ).toEqual(['Ana', 'Marc', 'Ines']);
    });

    it('draws a role chip for whoever has a resolved role', async () => {
      const role: ZoneRole = 'OWNER';
      const fixture = await render([viewer('Ana', { role }), viewer('Marc')]);
      open(fixture);

      expect(host(fixture).querySelectorAll('lib-role-chip').length).toBe(1);
    });

    // Nothing on the wire says when somebody opened the list, so a viewer the client
    // has only just seen has no time at all. Saying so in words is honest; stamping
    // them with the current one would be a guess dressed as a fact.
    it('says "here now" rather than inventing a time', async () => {
      const fixture = await render([viewer('Ana')]);
      open(fixture);

      expect(
        host(fixture).querySelector('.person-when')?.textContent
      ).toContain('list.presence.hereNow');
      expect(host(fixture).querySelector('time')).toBeNull();
    });

    it('gives the instant to a parser as well as to a reader', async () => {
      const since = new Date('2026-08-28T15:04:00.000Z');
      const fixture = await render([viewer('Ana', { since })]);
      open(fixture);

      const when = host(fixture).querySelector('time');
      expect(when?.getAttribute('datetime')).toBe(since.toISOString());
      expect(when?.textContent).toContain('list.presence.since');
    });

    it('closes again on a second press', async () => {
      const fixture = await render([viewer('Ana')]);
      open(fixture);
      open(fixture);

      expect(host(fixture).querySelector('.people')).toBeNull();
    });

    // A click anywhere else closes it and leaves focus where it landed, which is how
    // every other disclosure on these screens behaves.
    it('closes when something outside it is clicked', async () => {
      const fixture = await render([viewer('Ana')]);
      open(fixture);

      document.body.click();
      fixture.detectChanges();

      expect(host(fixture).querySelector('.people')).toBeNull();
    });
  });
});
