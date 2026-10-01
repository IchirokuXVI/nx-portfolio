import {
  PINCH_DEAD_ZONE_PX,
  pinchDeadZone,
  pinchStart,
  pinchStep,
} from './pinch';

describe('the two finger rule', () => {
  it('starts as a move, with the scale left alone', () => {
    const pinch = pinchStart(200);
    expect(pinch.zoomFrom).toBeNull();
    expect(pinchStep(pinch, 200).factor).toBe(1);
  });

  it('stays a move while the distance changes less than the dead zone', () => {
    let pinch = pinchStart(200);
    for (const distance of [205, 190, 222, 178, 224, 176]) {
      const step = pinchStep(pinch, distance);
      expect(step.factor).toBe(1);
      expect(step.pinch.zoomFrom).toBeNull();
      pinch = step.pinch;
    }
  });

  it('takes the larger of 12 percent and 24 css pixels as the dead zone', () => {
    expect(pinchDeadZone(100)).toBe(PINCH_DEAD_ZONE_PX);
    expect(pinchDeadZone(200)).toBe(24);
    expect(pinchDeadZone(400)).toBe(48);
  });

  it('becomes a zoom once the fingers spread past the dead zone, with no jump', () => {
    const step = pinchStep(pinchStart(200), 230);
    expect(step.pinch.zoomFrom).toBe(230);
    // The frame that leaves the dead zone keeps the scale.
    expect(step.factor).toBe(1);
    // From then the scale follows the fingers from where they left it.
    expect(pinchStep(step.pinch, 460).factor).toBe(2);
    expect(pinchStep(step.pinch, 115).factor).toBe(0.5);
  });

  it('becomes a zoom when the fingers close past the dead zone too', () => {
    const step = pinchStep(pinchStart(200), 170);
    expect(step.pinch.zoomFrom).toBe(170);
    expect(pinchStep(step.pinch, 85).factor).toBe(0.5);
  });

  it('stays a zoom when the fingers come back to where they started', () => {
    const zooming = pinchStep(pinchStart(200), 230).pinch;
    const back = pinchStep(zooming, 200);
    expect(back.pinch.zoomFrom).toBe(230);
    expect(back.factor).toBeCloseTo(200 / 230);
  });

  it('never divides by nothing for two fingers on one point', () => {
    const pinch = pinchStart(0);
    expect(pinch.start).toBe(1);
    expect(Number.isFinite(pinchStep(pinch, 0).factor)).toBe(true);
  });
});
