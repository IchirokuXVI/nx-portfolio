import { HeldProductChoices } from './held-product-choices';

describe('HeldProductChoices', () => {
  it('holds a product for each line of one basket', () => {
    const choices = new HeldProductChoices();

    choices.hold('b-1', ['zl-1', 'zl-2'], { itemId: 'oat', product: null });

    expect([...choices.heldOn('b-1').keys()]).toEqual(['zl-1', 'zl-2']);
    expect(choices.heldOn('b-1').get('zl-2')?.itemId).toBe('oat');
    expect(choices.heldOn('b-2').size).toBe(0);
    expect(choices.heldOn(null).size).toBe(0);
  });

  it('replaces the choice of a line held again', () => {
    const choices = new HeldProductChoices();

    choices.hold('b-1', ['zl-1'], { itemId: 'oat', product: null });
    choices.hold('b-1', ['zl-1'], { itemId: 'soy', product: null });

    expect(choices.heldOn('b-1').get('zl-1')?.itemId).toBe('soy');
  });

  it('lets the lines it releases follow the server again', () => {
    const choices = new HeldProductChoices();
    choices.hold('b-1', ['zl-1', 'zl-2'], { itemId: 'oat', product: null });

    choices.release('b-1', ['zl-1']);
    expect([...choices.heldOn('b-1').keys()]).toEqual(['zl-2']);

    choices.release('b-1', ['zl-2']);
    expect(choices.heldOn('b-1').size).toBe(0);
  });

  it('holds nothing for no lines', () => {
    const choices = new HeldProductChoices();
    const before = choices.heldOn('b-1');

    choices.hold('b-1', [], { itemId: 'oat', product: null });

    expect(choices.heldOn('b-1')).toBe(before);
  });
});
