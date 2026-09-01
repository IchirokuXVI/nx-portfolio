import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import type { ShoppingListCardVm } from '@portfolio/velista/models';
import { ShoppingListCard } from './shopping-list-card';

/**
 * The dashboard's shopping list card (plan 0045, section 3.2).
 *
 * It replaced `ResumeListCard`, and the assertions worth keeping are the ones that
 * belong to a component: what it draws for a given view model, and that its two
 * destinations are two controls rather than one.
 */

function card(overrides: Partial<ShoppingListCardVm> = {}): ShoppingListCardVm {
  return {
    id: 'gl1',
    name: 'Saturday big shop',
    generatedAt: new Date('2026-08-21T10:00:00.000Z'),
    lineCount: 12,
    settledLineCount: 4,
    breakdown: { bought: 3, notAvailable: 1 },
    presentCount: 0,
    otherActiveCount: 0,
    ...overrides,
  };
}

async function render(
  vm: ShoppingListCardVm = card(),
  inputs: { generatedToday?: boolean; generatedOn?: string } = {}
): Promise<ComponentFixture<ShoppingListCard>> {
  TestBed.resetTestingModule();

  await TestBed.configureTestingModule({
    imports: [ShoppingListCard, RokuTranslatorTestingModule.forTesting()],
  }).compileComponents();

  const fixture = TestBed.createComponent(ShoppingListCard);
  fixture.componentRef.setInput('list', vm);
  fixture.componentRef.setInput(
    'generatedToday',
    inputs.generatedToday ?? false
  );
  fixture.componentRef.setInput(
    'generatedOn',
    inputs.generatedOn ?? '21 August'
  );
  fixture.detectChanges();
  return fixture;
}

const element = (fixture: ComponentFixture<ShoppingListCard>) =>
  fixture.nativeElement as HTMLElement;

describe('ShoppingListCard', () => {
  // The date itself is interpolated into the key, and the testing translator returns
  // keys without interpolating them, so which **key** is chosen is the observable half
  // here. The date's own formatting is `formatGeneratedDate`'s and is tested there.
  it('names the basket, and says when it was generated', async () => {
    const fixture = await render(card(), { generatedOn: '21 August' });

    expect(element(fixture).textContent).toContain('Saturday big shop');
    expect(element(fixture).textContent).toContain(
      'home.shoppingList.generatedOn'
    );
  });

  it('says today rather than the date for the trip somebody is in the middle of', async () => {
    const fixture = await render(card(), { generatedToday: true });

    expect(element(fixture).textContent).toContain(
      'home.shoppingList.generatedToday'
    );
    expect(element(fixture).textContent).not.toContain(
      'home.shoppingList.generatedOn'
    );
  });

  it('draws the progress as a fraction of the trip', async () => {
    const fixture = await render();

    expect(fixture.componentInstance.progress()).toBe(33);
    expect(element(fixture).querySelector('.fill')).not.toBeNull();
  });

  // A basket composed with no lines has nothing to be a fraction of, and a bar at zero
  // over an empty basket reads as a trip nobody has started rather than as no trip.
  it('draws no bar for a basket with no lines', async () => {
    const fixture = await render(card({ lineCount: 0, settledLineCount: 0 }));

    expect(fixture.componentInstance.progress()).toBeNull();
    expect(element(fixture).querySelector('.progress')).toBeNull();
  });

  /**
   * Section 7 asks the card's accessible name to be the list plus what is outstanding.
   * Outstanding is the subtraction rather than the settled count: somebody deciding
   * whether to open this wants to know what is **left**, and "4 of 12 got" makes them
   * do the arithmetic.
   */
  it('states its own accessible name instead of letting the parts be read in order', async () => {
    const fixture = await render();

    expect(fixture.componentInstance.outstanding()).toBe(8);
    expect(
      element(fixture).querySelector('.card')?.getAttribute('aria-label')
    ).toBe('home.shoppingList.open');
  });

  // The bar would otherwise make the card announce its fraction a third time, after
  // the accessible name and the sentence under it.
  it('hides the bar from a screen reader, since the sentence says the same thing', async () => {
    const fixture = await render();

    expect(
      element(fixture).querySelector('.track')?.getAttribute('aria-hidden')
    ).toBe('true');
  });

  describe('the other live baskets', () => {
    it('says nothing when this is the only one', async () => {
      const fixture = await render();

      expect(element(fixture).querySelector('.more')).toBeNull();
    });

    /**
     * A separate control and not part of the card, because it goes somewhere else: the
     * card opens a basket and this opens the history, so section 7 wants two stops.
     */
    it('offers the others as a control of its own, outside the card', async () => {
      const fixture = await render(card({ otherActiveCount: 2 }));

      const more = element(fixture).querySelector('.more');
      expect(more).not.toBeNull();
      // Outside the card's button: a button inside a button is invalid markup and a
      // screen reader cannot reach the inner one.
      expect(element(fixture).querySelector('.card .more')).toBeNull();
    });

    it('goes to the history rather than to the basket', async () => {
      const fixture = await render(card({ otherActiveCount: 2 }));

      let history = 0;
      let opened = 0;
      fixture.componentInstance.openHistory.subscribe(() => (history += 1));
      fixture.componentInstance.open.subscribe(() => (opened += 1));

      (element(fixture).querySelector('.more') as HTMLElement).click();

      expect(history).toBe(1);
      expect(opened).toBe(0);
    });
  });

  it('opens the basket it names, by id', async () => {
    const fixture = await render();

    let openedWith: string | null = null;
    fixture.componentInstance.open.subscribe((id) => (openedWith = id));

    (element(fixture).querySelector('.card') as HTMLElement).click();

    expect(openedWith).toBe('gl1');
  });

  it('offers the history from its own header', async () => {
    const fixture = await render();

    let history = 0;
    fixture.componentInstance.openHistory.subscribe(() => (history += 1));

    (element(fixture).querySelector('.history') as HTMLElement).click();

    expect(history).toBe(1);
  });

  /**
   * Who is here now (velista plan 0049, section 4).
   *
   * `0045` refused this row and named its price: a request per card on every dashboard
   * load, to draw something usually absent. Backend `0053` put `presentCount` on the
   * summary the card already reads, so it now costs a field, which is exactly the
   * condition that plan said would change the answer.
   *
   * It stays a **count and never names**: the summary carries a number, and `0044`'s
   * participant surface answers who *may* open this basket rather than who has.
   */
  describe('who is shopping it now', () => {
    it('says how many are here when somebody is', async () => {
      const fixture = await render(card({ presentCount: 2 }));

      expect(element(fixture).textContent).toContain('home.presence.hereCount');
    });

    // "0 people here now" is furniture, and zero is the state of every basket nobody
    // is carrying, which is most of them most of the time.
    it('draws nothing at all when nobody is', async () => {
      const fixture = await render(card({ presentCount: 0 }));

      expect(element(fixture).querySelector('.present')).toBeNull();
    });

    /**
     * The button already states its own accessible name, which section 7 asks to be
     * the name plus what is left. A presence line inside it that a screen reader also
     * read would make the card announce a third fact in the middle of that sentence.
     */
    it('keeps it out of the button s stated name', async () => {
      const fixture = await render(card({ presentCount: 2 }));

      expect(
        element(fixture).querySelector('.present')?.getAttribute('aria-hidden')
      ).toBe('true');
    });

    it('never names anybody, because the summary carries no participants', async () => {
      const fixture = await render(card({ presentCount: 2 }));

      expect(element(fixture).querySelector('lib-presence-row')).toBeNull();
    });
  });

  /**
   * What the trip came to (velista plan 0049, section 2).
   *
   * The card is read mid trip, where "finished" was already close enough, so this is
   * consistency with the history row rather than the case the change exists for. The
   * fallback matters just as much here: a server with no breakdown must not make the
   * card claim purchases.
   */
  describe('what it says happened', () => {
    it('says what was got and what was unavailable', async () => {
      const fixture = await render(
        card({
          lineCount: 4,
          settledLineCount: 4,
          breakdown: { bought: 3, notAvailable: 1 },
        })
      );

      expect(element(fixture).textContent).toContain('home.shoppingList.got');
      expect(element(fixture).textContent).toContain(
        'home.shoppingList.unavailable'
      );
    });

    it('drops the unavailable half when there was none', async () => {
      const fixture = await render(
        card({ breakdown: { bought: 4, notAvailable: 0 } })
      );

      expect(element(fixture).textContent).toContain('home.shoppingList.got');
      expect(element(fixture).textContent).not.toContain(
        'home.shoppingList.unavailable'
      );
    });

    it('says finished where there is no breakdown to draw', async () => {
      const fixture = await render(card({ breakdown: null }));

      expect(element(fixture).textContent).toContain(
        'home.shoppingList.progress'
      );
      expect(element(fixture).textContent).not.toContain(
        'home.shoppingList.got'
      );
    });
  });
});
