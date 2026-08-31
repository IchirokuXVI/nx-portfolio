import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import { provideVelistaTesting } from '@portfolio/velista/platform';
import { AssistantMessage, type AssistantMessageVm } from './assistant-message';

/**
 * What a reply offers under it (plan 0042, section 9).
 *
 * The translator double answers with the key rather than the copy, so the assertions
 * about the two readings are assertions about **which key** was asked for. That is the
 * point of the two keys: "Go to X" and "Go to X, in Y" read as different sentences in
 * Spanish, and a translator has to see both.
 */
const REPLY: AssistantMessageVm = {
  speaker: 'bot',
  kind: 'said',
  text: 'It is not on the weekly shop, so I have added it.',
  choices: [],
};

async function render(
  overrides: Partial<AssistantMessageVm> = {}
): Promise<ComponentFixture<AssistantMessage>> {
  TestBed.resetTestingModule();

  await TestBed.configureTestingModule({
    imports: [AssistantMessage, RokuTranslatorTestingModule.forTesting()],
    providers: [provideRouter([]), provideVelistaTesting()],
  }).compileComponents();

  const fixture = TestBed.createComponent(AssistantMessage);
  fixture.componentRef.setInput('message', { ...REPLY, ...overrides });
  fixture.detectChanges();

  return fixture;
}

function host(fixture: ComponentFixture<AssistantMessage>): HTMLElement {
  return fixture.nativeElement as HTMLElement;
}

describe('AssistantMessage', () => {
  describe('the one link', () => {
    it('draws a single anchor to the list, and says where it goes', async () => {
      const fixture = await render({
        link: {
          label: 'Compra semanal',
          zoneLabel: null,
          path: '/en/zones/z1/lists/l1',
        },
      });

      const links = host(fixture).querySelectorAll('a.link');

      expect(links).toHaveLength(1);
      expect(links[0].getAttribute('href')).toBe('/en/zones/z1/lists/l1');
      expect(links[0].textContent).toContain('assistant.goTo');
      // Never colour alone: the glyph carries the same signal the colour does.
      expect(links[0].querySelector('.link-glyph')).not.toBeNull();
    });

    it('names the zone only when the server sent one', async () => {
      const withZone = await render({
        link: {
          label: 'Compra semanal',
          zoneLabel: 'Casa',
          path: '/en/zones/z1/lists/l1',
        },
      });

      expect(host(withZone).querySelector('a.link')?.textContent).toContain(
        'assistant.goToInZone'
      );

      const without = await render({
        link: {
          label: 'Compra semanal',
          zoneLabel: null,
          path: '/en/zones/z1/lists/l1',
        },
      });

      expect(host(without).querySelector('a.link')?.textContent).not.toContain(
        'assistant.goToInZone'
      );
    });

    it('draws nothing when the reply sends nobody anywhere', async () => {
      const fixture = await render();

      expect(host(fixture).querySelector('a.link')).toBeNull();
      expect(host(fixture).querySelector('.choices')).toBeNull();
    });
  });

  describe('the answers', () => {
    const CHOICES = [
      { label: 'Compra semanal · Casa', message: 'the weekly shop' },
      { label: 'Compra · Oficina', message: 'the office one' },
    ];

    it('draws one button per answer, labelled by its own text', async () => {
      const fixture = await render({
        text: 'Which list did you mean?',
        choices: CHOICES,
      });

      const chips = host(fixture).querySelectorAll('button.choice');

      expect(chips).toHaveLength(2);
      expect(chips[0].textContent?.trim()).toBe('Compra semanal · Casa');
      expect(chips[1].textContent?.trim()).toBe('Compra · Oficina');
    });

    it('emits the message rather than the label, since that is what is said', async () => {
      const fixture = await render({
        text: 'Which list did you mean?',
        choices: CHOICES,
      });

      const said: string[] = [];
      fixture.componentInstance.chose.subscribe((message) =>
        said.push(message)
      );

      host(fixture)
        .querySelectorAll<HTMLButtonElement>('button.choice')[1]
        .click();

      expect(said).toEqual(['the office one']);
    });

    it('labels the group by the question above it when there is one', async () => {
      const fixture = await render({
        text: 'Which list did you mean?',
        choices: CHOICES,
        bubbleId: 'bubble-turn-3',
      });

      const group = host(fixture).querySelector('.choices');

      expect(group?.getAttribute('aria-labelledby')).toBe('bubble-turn-3');
      expect(host(fixture).querySelector('.bubble')?.id).toBe('bubble-turn-3');
    });

    it('falls back to a key when the panel wrote the reply itself', async () => {
      // No bubble id, so there is no question to point at and the group needs a name
      // of its own rather than being a loose row of buttons.
      const fixture = await render({ choices: CHOICES });
      const group = host(fixture).querySelector('.choices');

      expect(group?.getAttribute('aria-labelledby')).toBeNull();
      expect(group?.getAttribute('aria-label')).toBe('assistant.choices.label');
    });
  });

  it('draws both when a turn somehow carries both', async () => {
    // Section 4.4: a turn that asks sends no link and a turn that links asks nothing,
    // but a template that renders whatever it is handed is one fewer thing that can be
    // wrong when the server changes its mind.
    const fixture = await render({
      link: {
        label: 'Compra semanal',
        zoneLabel: null,
        path: '/en/zones/z1/lists/l1',
      },
      choices: [{ label: 'Compra · Oficina', message: 'the office one' }],
    });

    expect(host(fixture).querySelector('a.link')).not.toBeNull();
    expect(host(fixture).querySelectorAll('button.choice')).toHaveLength(1);
  });
});
