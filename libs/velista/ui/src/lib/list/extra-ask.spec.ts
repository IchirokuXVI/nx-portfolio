import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { BackStack } from '@portfolio/velista/platform';
import { ExtraAsk } from './extra-ask';
import type { ExtraAskWords } from './extra-ask-words';

/**
 * The question about the extra already bought (velista `0207`): the two sentences
 * as its title, "Still need" then "Count the extra", focus on "Still need", the
 * answer that changes nothing (velista `0208`, target state 5), and no press
 * reaching the row it sits in.
 */
const WORDS: ExtraAskWords = {
  question: 'Marta already bought 1 extra. Do you still need 2, or just 1?',
  stillNeed: { words: 'Still need', amount: '2 units' },
  keep: { words: 'Count the extra', amount: '1 unit' },
};

const ENOUGH: ExtraAskWords = {
  question:
    'Marta already bought 1 extra. Do you still need 1, or is that enough?',
  stillNeed: { words: 'Still need', amount: '1 unit' },
  keep: { words: "That's enough", amount: null },
};

async function render(
  words: ExtraAskWords = WORDS,
  takeFocus = true
): Promise<ComponentFixture<ExtraAsk>> {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [ExtraAsk],
  }).compileComponents();
  const fixture = TestBed.createComponent(ExtraAsk);
  fixture.componentRef.setInput('words', words);
  fixture.componentRef.setInput('titleId', 'ask-title');
  fixture.componentRef.setInput('takeFocus', takeFocus);
  document.body.append(fixture.nativeElement);
  fixture.detectChanges();
  await fixture.whenStable();
  return fixture;
}

function answers(fixture: ComponentFixture<ExtraAsk>): HTMLButtonElement[] {
  return [
    ...(
      fixture.nativeElement as HTMLElement
    ).querySelectorAll<HTMLButtonElement>('.answer'),
  ];
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('ExtraAsk (velista 0207)', () => {
  it('draws the question as its title, then "Still need" and "Count the extra" with their amounts', async () => {
    const fixture = await render();
    const host = fixture.nativeElement as HTMLElement;

    const title = host.querySelector('#ask-title');
    expect(title?.textContent?.trim()).toBe(WORDS.question);
    const [still, keep] = answers(fixture);
    expect(still.querySelector('.words')?.textContent?.trim()).toBe(
      'Still need'
    );
    expect(still.querySelector('.amount')?.textContent?.trim()).toBe('2 units');
    expect(keep.querySelector('.words')?.textContent?.trim()).toBe(
      'Count the extra'
    );
    expect(keep.querySelector('.amount')?.textContent?.trim()).toBe('1 unit');
  });

  it('draws "That\'s enough" with no amount', async () => {
    const fixture = await render(ENOUGH);
    const [, keep] = answers(fixture);
    expect(keep.textContent?.trim()).toBe("That's enough");
    expect(keep.querySelector('.amount')).toBeNull();
  });

  it('puts focus on "Still need", the answer that changes nothing, never on the count (velista 0208, spec 7)', async () => {
    for (const words of [WORDS, ENOUGH]) {
      const fixture = await render(words);
      expect(document.activeElement).toBe(answers(fixture)[0]);
    }
  });

  it('leaves focus where it is when told not to take it', async () => {
    const field = document.createElement('input');
    document.body.append(field);
    field.focus();

    await render(WORDS, false);

    expect(document.activeElement).toBe(field);
  });

  it('says which answer was pressed, and the back gesture dismisses it', async () => {
    const fixture = await render();
    const said: string[] = [];
    fixture.componentInstance.stillNeed.subscribe(() => said.push('still'));
    fixture.componentInstance.kept.subscribe(() => said.push('kept'));
    fixture.componentInstance.dismissed.subscribe(() => said.push('dismissed'));

    const [still, keep] = answers(fixture);
    still.click();
    keep.click();
    expect(TestBed.inject(BackStack).handle()).toBe(true);

    expect(said).toEqual(['still', 'kept', 'dismissed']);
  });

  it('keeps a press inside it from reaching the row it is drawn in', async () => {
    const fixture = await render();
    const row = document.createElement('div');
    const opened = jest.fn();
    row.addEventListener('click', opened);
    row.addEventListener('pointerdown', opened);
    row.append(fixture.nativeElement);
    document.body.append(row);

    answers(fixture)[1].click();
    answers(fixture)[1].dispatchEvent(
      new Event('pointerdown', { bubbles: true })
    );

    expect(opened).not.toHaveBeenCalled();
  });
});
