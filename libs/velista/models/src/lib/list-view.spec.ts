import { lineStatuses } from './list-view';

describe('lineStatuses (velista 0145, section 4)', () => {
  it('says nothing about an ordinary row', () => {
    expect(
      lineStatuses({ approvalStatus: 'APPROVED', indicators: [] })
    ).toEqual([]);
  });

  it('puts waiting for approval before everything else', () => {
    expect(
      lineStatuses({
        approvalStatus: 'PENDING',
        indicators: ['bought', 'notAvailable', 'claimed'],
      })
    ).toEqual(['awaiting', 'claimed', 'notAvailable', 'bought']);
  });

  it('puts the word of a line turned down first', () => {
    expect(
      lineStatuses({ approvalStatus: 'REJECTED', indicators: ['bought'] })
    ).toEqual(['rejected', 'bought']);
  });

  it('puts somebody buying it before not available, and that before bought', () => {
    expect(
      lineStatuses({
        approvalStatus: 'APPROVED',
        indicators: ['bought', 'notAvailable', 'claimed'],
      })
    ).toEqual(['claimed', 'notAvailable', 'bought']);
  });
});
