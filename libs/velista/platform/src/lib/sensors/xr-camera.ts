import type {
  CaptureNavigator,
  CaptureWindow,
  XrFrameLike,
  XrPoseLike,
  XrSessionLike,
} from './browser-types';
import { describeError } from './orientation-stream';

/** What opening the camera needs. Every browser object is passed in, so a spec can fake them. */
export interface XrCameraOptions {
  readonly window: (Window & CaptureWindow) | null;
  readonly navigator: (Navigator & CaptureNavigator) | null;
  readonly document: Document;
  /** The element WebXR's DOM overlay shows over the camera: the recording screen. */
  readonly overlayRoot: Element | null;
  /** Called just before the session is asked for, once WebXR is known to exist. */
  requesting?(): void;
  /** Asked once the session opened: false ends it at once, because nobody wants it any more. */
  wanted(): boolean;
  /**
   * Every frame: its time on the `performance.now()` clock, and the viewer pose in
   * the `local` reference space, or null when the frame has none. A pose with
   * `emulatedPosition` true is not tracked.
   */
  frame(time: number, pose: XrPoseLike | null): void;
  /** The browser ended the session (not a call to `end`). */
  ended(): void;
}

/** An open camera session. */
export interface XrCamera {
  readonly session: XrSessionLike;
  /** Ends the session. Safe to call twice. */
  end(): void;
}

export type XrCameraOpen =
  | { readonly kind: 'open'; readonly camera: XrCamera }
  /** `detail` is the sentence the lab writes into its walk as a `tracking-failed` event. */
  | {
      readonly kind: 'failed';
      /** Where it failed: WebXR is missing, the session was refused, or setting it up broke. */
      readonly stage: 'unavailable' | 'request' | 'setup';
      readonly detail: string;
    }
  | { readonly kind: 'unwanted' };

/** Whether camera tracking can be offered: `isSessionSupported('immersive-ar')`. */
export async function immersiveArSupported(
  navigator: (Navigator & CaptureNavigator) | null
): Promise<boolean> {
  try {
    const xr = navigator?.xr;
    return xr ? await xr.isSessionSupported('immersive-ar') : false;
  } catch {
    return false;
  }
}

/**
 * WebXR `immersive-ar` with a DOM overlay, the `local` reference space, and the
 * viewer pose of every frame (recorder plan 0002, section 7; velista `0126`,
 * target 10). Moved here from the walk lab, which opens it through this too.
 *
 * **Call it straight from the tap**: the session needs the user activation the tap
 * carries, so nothing is awaited before `requestSession`.
 *
 * Nothing is drawn: every frame clears the layer to transparent, so the camera
 * shows through wherever the overlay is transparent. Best effort from end to end:
 * any step that fails answers `failed` with a line saying which, and never throws.
 */
export async function openXrCamera(
  options: XrCameraOptions
): Promise<XrCameraOpen> {
  const win = options.window;
  const xr = options.navigator?.xr;
  if (!win || !xr || !win.XRWebGLLayer) {
    return {
      kind: 'failed',
      stage: 'unavailable',
      detail: 'WebXR is not available',
    };
  }

  options.requesting?.();
  let session: XrSessionLike;
  try {
    const root = options.overlayRoot;
    session = await xr.requestSession('immersive-ar', {
      optionalFeatures: ['dom-overlay'],
      ...(root ? { domOverlay: { root } } : {}),
    });
  } catch (error) {
    return {
      kind: 'failed',
      stage: 'request',
      detail: `requestSession: ${describeError(error)}`,
    };
  }

  if (!options.wanted()) {
    void session.end().catch(() => undefined);
    return { kind: 'unwanted' };
  }

  let ending = false;
  const camera: XrCamera = {
    session,
    end: () => {
      if (ending) {
        return;
      }
      ending = true;
      void session.end().catch(() => undefined);
    },
  };

  try {
    const canvas = options.document.createElement('canvas');
    const gl = canvas.getContext('webgl', {
      xrCompatible: true,
      alpha: true,
    } as WebGLContextAttributes) as WebGLRenderingContext | null;
    if (!gl) {
      throw new Error('no WebGL context');
    }
    session.updateRenderState({
      baseLayer: new win.XRWebGLLayer(session, gl),
    });
    const space = await session.requestReferenceSpace('local');

    const onFrame = (time: number, frame: XrFrameLike) => {
      if (ending) {
        return;
      }
      session.requestAnimationFrame(onFrame);

      // Clear to transparent so the camera shows through; nothing is drawn.
      const layer = session.renderState.baseLayer;
      if (layer) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, layer.framebuffer);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      }

      options.frame(time, frame.getViewerPose(space));
    };

    session.addEventListener('end', () => {
      if (!ending) {
        ending = true;
        options.ended();
      }
    });

    if (!options.wanted()) {
      camera.end();
      return { kind: 'unwanted' };
    }
    session.requestAnimationFrame(onFrame);
  } catch (error) {
    camera.end();
    return { kind: 'failed', stage: 'setup', detail: describeError(error) };
  }

  return { kind: 'open', camera };
}
