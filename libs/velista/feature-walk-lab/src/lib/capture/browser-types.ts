/**
 * The few browser interfaces the capture service needs that TypeScript's DOM library
 * does not ship: the Generic Sensor API, WebXR, and the iOS motion permission. Typed
 * narrowly, to exactly the members read, so nothing here pretends to be the whole API.
 */

export interface OrientationSensorLike extends EventTarget {
  readonly quaternion: readonly number[] | null;
  readonly timestamp: number | null;
  start(): void;
  stop(): void;
}

export type OrientationSensorConstructor = new (options: {
  frequency: number;
  referenceFrame?: 'device' | 'screen';
}) => OrientationSensorLike;

export interface SensorErrorEventLike extends Event {
  readonly error: DOMException;
}

export interface XrPoseLike {
  readonly emulatedPosition: boolean;
  readonly transform: {
    readonly position: DOMPointReadOnly;
    readonly orientation: DOMPointReadOnly;
  };
}

export interface XrFrameLike {
  getViewerPose(space: unknown): XrPoseLike | null;
}

export interface XrSessionLike extends EventTarget {
  readonly visibilityState?: 'visible' | 'visible-blurred' | 'hidden';
  readonly renderState: { readonly baseLayer?: { framebuffer: WebGLFramebuffer | null } };
  requestReferenceSpace(type: 'local' | 'viewer'): Promise<unknown>;
  requestAnimationFrame(callback: (time: number, frame: XrFrameLike) => void): number;
  updateRenderState(state: { baseLayer: unknown }): void;
  end(): Promise<void>;
}

export interface XrSystemLike {
  isSessionSupported(mode: 'immersive-ar'): Promise<boolean>;
  requestSession(
    mode: 'immersive-ar',
    init: {
      optionalFeatures?: string[];
      requiredFeatures?: string[];
      domOverlay?: { root: Element };
    }
  ): Promise<XrSessionLike>;
}

export type XrWebGlLayerConstructor = new (
  session: XrSessionLike,
  context: WebGLRenderingContext
) => unknown;

/** The extra members read off `window` and `navigator`, all optional. */
export interface CaptureWindow {
  RelativeOrientationSensor?: OrientationSensorConstructor;
  AbsoluteOrientationSensor?: OrientationSensorConstructor;
  XRWebGLLayer?: XrWebGlLayerConstructor;
  DeviceMotionEvent?: { requestPermission?: () => Promise<'granted' | 'denied'> };
  DeviceOrientationEvent?: {
    requestPermission?: () => Promise<'granted' | 'denied'>;
  };
}

export interface CaptureNavigator {
  xr?: XrSystemLike;
}
