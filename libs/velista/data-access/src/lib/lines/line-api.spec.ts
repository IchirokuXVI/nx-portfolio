import { addLineOptionsRequest } from './line-api';

/**
 * What a typed add says about a name the list holds, as the request carries it
 * (backend `0228`, velista `0170`, target 1). Each field only as itself: a `false`
 * or an empty id is never sent, so an absent field keeps the server's default.
 */
describe('addLineOptionsRequest', () => {
  it('sends nothing for no options', () => {
    expect(addLineOptionsRequest(undefined)).toEqual({});
    expect(addLineOptionsRequest({})).toEqual({});
  });

  it('asks when the caller can draw a question', () => {
    expect(addLineOptionsRequest({ askIfAmbiguous: true })).toEqual({
      askIfAmbiguous: true,
    });
  });

  it('sends the chosen line alone, or the new line alone', () => {
    expect(
      addLineOptionsRequest({ askIfAmbiguous: true, intoLineId: 'line-a' })
    ).toEqual({ intoLineId: 'line-a' });
    expect(
      addLineOptionsRequest({ askIfAmbiguous: true, newLine: true })
    ).toEqual({ newLine: true });
  });

  it('never sends an empty id', () => {
    expect(addLineOptionsRequest({ intoLineId: '' })).toEqual({});
  });
});
