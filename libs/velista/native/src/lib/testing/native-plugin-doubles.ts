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
  /** What `VelistaGoogle.getIdToken` answers, or what it rejects with. */
  googleAnswer: unknown = { idToken: 'id-token' };
  googleError: unknown = null;
  googleRequests: unknown[] = [];
  forgets = 0;
  loads = 0;

  /** The updater's answers. A method named in `updaterErrors` rejects instead. */
  updaterErrors = new Set<string>();
  currentAnswer: unknown = {
    bundle: { id: 'builtin', version: '0.20.0', status: 'success' },
    native: '0.20.0',
  };
  listAnswer: unknown = { bundles: [] };
  /** What `download()` rejects with when set, as a wrong checksum does. */
  downloadError: unknown = null;
  failedAnswers: unknown[] = [];
  downloads: unknown[] = [];
  sets: unknown[] = [];
  resets = 0;
  readyNotices = 0;

  /** What `VelistaNativeInfo.info()` answers, or what it rejects with. */
  nativeInfoAnswer: unknown = {
    nativeApi: 1,
    otaBaseUrl: 'https://staging.velista.app/ota/android/',
    otaPublicKey: 'PEM',
    builtinBundle: '0.20.0+0f7476f4e1a2',
  };
  nativeInfoError: unknown = null;

  /** What `CapacitorHttp.request` answers, or what it rejects with. */
  httpAnswer: { status: number; data: unknown } = { status: 200, data: '{}' };
  httpError: unknown = null;
  httpRequests: unknown[] = [];

  /** Play's answers. A method named in `appUpdateErrors` rejects instead. */
  appUpdateErrors = new Set<string>();
  appUpdateInfoAnswer: unknown = {
    currentVersionCode: '20000',
    currentVersionName: '0.20.0',
    updateAvailability: 1,
  };
  flexibleAnswer: unknown = { code: 0 };
  immediateAnswer: unknown = { code: 0 };
  flexibleCompletions = 0;

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
    google: {
      getIdToken: async (options) => {
        this.googleRequests.push(options);
        if (this.googleError !== null) {
          throw this.googleError;
        }
        return this.googleAnswer as { idToken: string };
      },
      forget: async () => {
        this.forgets++;
      },
    },
    updater: {
      notifyAppReady: async () => {
        this._updaterCall('notifyAppReady');
        this.readyNotices++;
        return {};
      },
      download: async (options) => {
        this._updaterCall('download');
        this.downloads.push(options);
        if (this.downloadError !== null) {
          throw this.downloadError;
        }
        return {
          id: 'r4nd0m1d00',
          version: options.version,
          status: 'pending',
        };
      },
      set: async (options) => {
        this._updaterCall('set');
        this.sets.push(options);
      },
      reset: async () => {
        this._updaterCall('reset');
        this.resets++;
      },
      list: async () => {
        this._updaterCall('list');
        return this.listAnswer;
      },
      current: async () => {
        this._updaterCall('current');
        return this.currentAnswer;
      },
      getFailedUpdate: async () => {
        this._updaterCall('getFailedUpdate');
        return this.failedAnswers.shift() ?? null;
      },
    },
    appUpdate: {
      getAppUpdateInfo: async () => {
        this._appUpdateCall('getAppUpdateInfo');
        return this.appUpdateInfoAnswer;
      },
      startFlexibleUpdate: async () => {
        this._appUpdateCall('startFlexibleUpdate');
        return this.flexibleAnswer;
      },
      completeFlexibleUpdate: async () => {
        this._appUpdateCall('completeFlexibleUpdate');
        this.flexibleCompletions++;
      },
      performImmediateUpdate: async () => {
        this._appUpdateCall('performImmediateUpdate');
        return this.immediateAnswer;
      },
      addListener: async (eventName, listener) => {
        this._appUpdateCall('addListener');
        this.listeners.set(eventName, listener);
        return { remove: async () => void this.listeners.delete(eventName) };
      },
    },
    nativeInfo: {
      info: async () => {
        if (this.nativeInfoError !== null) {
          throw this.nativeInfoError;
        }
        return this.nativeInfoAnswer;
      },
    },
    http: {
      request: async (options) => {
        this.httpRequests.push(options);
        if (this.httpError !== null) {
          throw this.httpError;
        }
        return this.httpAnswer;
      },
    },
  };

  private _updaterCall(method: string): void {
    if (this.updaterErrors.has(method)) {
      throw new Error(`updater refused ${method}`);
    }
  }

  private _appUpdateCall(method: string): void {
    if (this.appUpdateErrors.has(method)) {
      throw new Error(`Play refused ${method}`);
    }
  }

  /** The value to provide for `NATIVE_PLUGINS`. */
  readonly loader = (): Promise<NativePlugins> => {
    this.loads++;
    return Promise.resolve(this.plugins);
  };
}
