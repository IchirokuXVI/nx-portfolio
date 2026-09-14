import {
  QUANTITY_REEL_TAP_MAX_MS,
  QUANTITY_REEL_TAP_SLOP_PX,
} from '@portfolio/velista/models';
import { classifyReelGesture } from './quantity-reel-gesture';

/**
 * Velista `0079`, section 8: the three gestures a press on the reel can be.
 *
 * The cases sit either side of the two limits rather than far from them, because the
 * limits are the rule and a case far from one proves nothing about where it is.
 */
describe('classifyReelGesture', () => {
  const past = QUANTITY_REEL_TAP_SLOP_PX + 1;

  it('reads a short still press as a tap', () => {
    expect(
      classifyReelGesture({ dx: 0, dy: 0, elapsedMs: 80, ended: true })
    ).toBe('tap');
  });

  it('still reads a tap that wandered inside the slop', () => {
    expect(
      classifyReelGesture({
        dx: QUANTITY_REEL_TAP_SLOP_PX,
        dy: -QUANTITY_REEL_TAP_SLOP_PX,
        elapsedMs: QUANTITY_REEL_TAP_MAX_MS,
        ended: true,
      })
    ).toBe('tap');
  });

  it('reads a sideways move past the slop as a drag, in either direction', () => {
    expect(
      classifyReelGesture({ dx: past, dy: 0, elapsedMs: 40, ended: false })
    ).toBe('drag');
    expect(
      classifyReelGesture({ dx: -past, dy: 2, elapsedMs: 40, ended: false })
    ).toBe('drag');
  });

  it('reads a vertical move past the slop as a scroll, in either direction', () => {
    expect(
      classifyReelGesture({ dx: 0, dy: past, elapsedMs: 40, ended: false })
    ).toBe('scroll');
    expect(
      classifyReelGesture({ dx: 3, dy: -past, elapsedMs: 40, ended: false })
    ).toBe('scroll');
  });

  it('reads a diagonal that goes further down than across as a scroll', () => {
    expect(
      classifyReelGesture({
        dx: past,
        dy: past + 4,
        elapsedMs: 40,
        ended: false,
      })
    ).toBe('scroll');
  });

  it('does not read a long still press as a tap', () => {
    expect(
      classifyReelGesture({
        dx: 0,
        dy: 0,
        elapsedMs: QUANTITY_REEL_TAP_MAX_MS + 1,
        ended: true,
      })
    ).not.toBe('tap');
  });

  it('decides nothing while a still press is held', () => {
    expect(
      classifyReelGesture({ dx: 1, dy: 1, elapsedMs: 900, ended: false })
    ).toBe('pending');
  });

  it('still reads a hold that then moves sideways as a drag', () => {
    expect(
      classifyReelGesture({ dx: past, dy: 0, elapsedMs: 2000, ended: false })
    ).toBe('drag');
  });
});
