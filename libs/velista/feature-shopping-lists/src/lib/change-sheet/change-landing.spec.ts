import { changeLandingOf, changeLandingState } from './change-landing';

describe('the landing of a change made from "Lists and amounts"', () => {
  it.each([-1, 0, 3])('reads back the depth %s it wrote', (depth) => {
    expect(changeLandingOf(changeLandingState(depth))).toBe(depth);
  });

  it.each([
    ['no state', undefined],
    ['a null state', null],
    ['a state of another screen', { member: 'Ana' }],
    ['a depth that is not a whole number', { velistaChangeLanding: 1.5 }],
    ['a depth that is a string', { velistaChangeLanding: '2' }],
  ])('reads %s as no landing', (_name, state) => {
    expect(changeLandingOf(state)).toBeNull();
  });
});
