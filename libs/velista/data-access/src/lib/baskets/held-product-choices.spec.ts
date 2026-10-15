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

  it('retains the lines it is told to keep and releases the rest', () => {
    const choices = new HeldProductChoices();
    choices.hold('b-1', ['zl-1', 'zl-2', 'zl-3'], {
      itemId: 'oat',
      product: null,
    });
    choices.hold('b-2', ['zl-9'], { itemId: 'soy', product: null });

    choices.retain('b-1', (lineId) => lineId === 'zl-2');
    expect([...choices.heldOn('b-1').keys()]).toEqual(['zl-2']);

    choices.retain('b-1', () => false);
    expect(choices.heldOn('b-1').size).toBe(0);
    // Another basket is not touched.
    expect([...choices.heldOn('b-2').keys()]).toEqual(['zl-9']);
  });

  it('writes nothing when every held line is retained', () => {
    const choices = new HeldProductChoices();
    choices.hold('b-1', ['zl-1'], { itemId: 'oat', product: null });
    const before = choices.heldOn('b-1');

    choices.retain('b-1', () => true);

    expect(choices.heldOn('b-1')).toBe(before);
  });

  it('holds nothing for no lines', () => {
    const choices = new HeldProductChoices();
    const before = choices.heldOn('b-1');

    choices.hold('b-1', [], { itemId: 'oat', product: null });

    expect(choices.heldOn('b-1')).toBe(before);
  });
});
