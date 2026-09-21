import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import type { LiveBasketCardVm } from '@portfolio/velista/models';
import { LiveBasketCard } from './live-basket-card';

/**
 * The way into the basket that is always there (velista `0091`, section 5.1).
 *
 * What is worth asserting here is what the card draws when it has **nothing**:
 * it is the door, so it is a control at zero, a control while the numbers are
 * out, and a control after a read that failed. Everything else is one sentence
 * the model chose.
 */

function card(overrides: Partial<LiveBasketCardVm> = {}): LiveBasketCardVm {
  return {
    sentence: {
      key: 'basket.live.left',
      args: { pending: 12 },
      unavailable: 0,
    },
    pending: 12,
    ...overrides,
  };
}

async function render(
  summary: LiveBasketCardVm | null = card(),
  loading = false
): Promise<ComponentFixture<LiveBasketCard>> {
  TestBed.resetTestingModule();

  await TestBed.configureTestingModule({
    imports: [LiveBasketCard, RokuTranslatorTestingModule.forTesting()],
  }).compileComponents();

  const fixture = TestBed.createComponent(LiveBasketCard);
  fixture.componentRef.setInput('summary', summary);
  fixture.componentRef.setInput('loading', loading);
  fixture.detectChanges();
  return fixture;
}

const text = (fixture: ComponentFixture<LiveBasketCard>) =>
  (fixture.nativeElement as HTMLElement).textContent ?? '';

const query = (fixture: ComponentFixture<LiveBasketCard>, selector: string) =>
  (fixture.nativeElement as HTMLElement).querySelector(selector);

describe('LiveBasketCard', () => {
  it('is titled the same words for everybody', async () => {
    // No name, no date, no owner: it is the same basket in the same place for
    // every reader, which is what one stable URL is for.
    const fixture = await render();

    expect(text(fixture)).toContain('basket.live.title');
  });

  it('draws the sentence the model chose', async () => {
    const fixture = await render();

    expect(text(fixture)).toContain('basket.live.left');
  });

  it('appends the unavailable clause, and only when there is one', async () => {
    const withNone = await render();
    expect(text(withNone)).not.toContain('basket.progressUnavailable');

    const withSome = await render(
      card({
        sentence: {
          key: 'basket.live.leftAndGot',
          args: { pending: 3, done: 1 },
          unavailable: 2,
        },
      })
    );
    expect(text(withSome)).toContain('basket.progressUnavailable');
  });

  it('is still a control with nothing to buy', async () => {
    // The card is the way in, and a way in that disappears when the basket
    // empties is a bug report.
    const fixture = await render(
      card({
        sentence: {
          key: 'basket.live.left',
          args: { pending: 0 },
          unavailable: 0,
        },
        pending: 0,
      })
    );

    expect(query(fixture, 'button.card')).not.toBeNull();
  });

  it('holds a skeleton of its own height while the numbers are out', async () => {
    const fixture = await render(null, true);

    const skeleton = query(fixture, '.meta-skeleton');
    expect(skeleton).not.toBeNull();
    // Hidden from the reader: the row announces nothing until there is
    // something to announce.
    expect(skeleton?.getAttribute('aria-hidden')).toBe('true');
  });

  it('draws its title and no sentence after a read that failed', async () => {
    const fixture = await render(null, false);

    expect(query(fixture, '.meta')).toBeNull();
    expect(query(fixture, '.meta-skeleton')).toBeNull();
    expect(query(fixture, 'button.card')).not.toBeNull();
  });

  it('is one control, named by what is left', async () => {
    const fixture = await render();

    expect(
      (fixture.nativeElement as HTMLElement).querySelectorAll('button')
    ).toHaveLength(1);
    expect(query(fixture, 'button.card')?.getAttribute('aria-label')).toBe(
      'home.liveBasket.open'
    );
  });

  it('names itself by its title alone before the numbers land', async () => {
    // A count nobody has read yet is not a fact, so it is not announced as one.
    const fixture = await render(null, true);

    expect(query(fixture, 'button.card')?.getAttribute('aria-label')).toBe(
      'basket.live.title'
    );
  });

  it('emits when it is tapped, and says nothing about where that goes', async () => {
    const fixture = await render();
    const opened = jest.fn();
    fixture.componentInstance.open.subscribe(opened);

    (query(fixture, 'button.card') as HTMLElement).click();

    expect(opened).toHaveBeenCalled();
  });
});
