import type {
  NativeListenerHandle,
  NativePermissionState,
  NativePlugins,
} from '../native-plugins';

/**
 * Hand built doubles of the Capacitor plugins, handed in through `NATIVE_PLUGINS` so
 * no spec mocks a package. Each records what it was asked and answers what the spec
 * set. Not exported from the library: specs import it by path.
 */
export class NativePluginDoubles {
  readonly listeners = new Map<string, (event?: unknown) => void>();
  minimized = 0;
  appId = 'app.velista.staging';
  shared: unknown[] = [];
  shareError: unknown = null;
  permission: NativePermissionState | Error = 'prompt';
  positionError: unknown = null;
  positionOptions: unknown[] = [];
  opened: string[] = [];
  styles: string[] = [];
  loads = 0;

  readonly plugins: NativePlugins = {
    app: {
      getInfo: async () => ({ id: this.appId }),
      minimizeApp: async () => {
        this.minimized++;
      },
      addListener: async (
        eventName: string,
        listener: (event?: never) => void
      ): Promise<NativeListenerHandle> => {
        this.listeners.set(eventName, listener as (event?: unknown) => void);
        return { remove: async () => void this.listeners.delete(eventName) };
      },
    },
    share: {
      share: async (options) => {
        if (this.shareError !== null) {
          throw this.shareError;
        }
        this.shared.push(options);
        return {};
      },
    },
    geolocation: {
      checkPermissions: async () => {
        if (this.permission instanceof Error) {
          throw this.permission;
        }
        return { location: this.permission };
      },
      getCurrentPosition: async (options) => {
        this.positionOptions.push(options);
        if (this.positionError !== null) {
          throw this.positionError;
        }
        return { coords: { latitude: 43.36, longitude: -8.41, accuracy: 12 } };
      },
    },
    browser: {
      open: async ({ url }) => {
        this.opened.push(url);
      },
    },
    systemBars: {
      setStyle: async ({ style }) => {
        this.styles.push(style);
      },
    },
  };

  /** The value to provide for `NATIVE_PLUGINS`. */
  readonly loader = (): Promise<NativePlugins> => {
    this.loads++;
    return Promise.resolve(this.plugins);
  };
}
