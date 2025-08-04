import { Injectable } from "@angular/core";
import { Observable, Subject } from "rxjs";
import { distinctUntilChanged, map, finalize, shareReplay, filter } from "rxjs/operators";
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

@Injectable()
export class LoadingNotifier<Loadable extends readonly string[]> {
  static readonly LOADABLE_ENTRIES = 'LoadingNotifier_LOADABLE_ENTRIES';

  private _loadings: { [key in Loadable[number]]?: { subj: Subject<boolean>, counter: number } } = {};
  private _loadings$: { [key in Loadable[number]]?: Observable<boolean> } = {};

  get loadings$() {
    const that = this;

    return new Proxy(this._loadings$, {
      get(target, key) {
        return that.getLoadable(key.toString(), true);
      }
    })
  }

  constructor() { }

  private addLoadable(loadable: Loadable[number]) {
    this._loadings[loadable] = {
      subj: new Subject(),
      counter: 0,
    }

    this._loadings$[loadable] = this._loadings[loadable].subj
      .asObservable()
      .pipe(
        takeUntilDestroyed(),
        map((loading) => {
          const loadingEntry = this._loadings[loadable];

          if (!loadingEntry) {
            throw new Error(`Expected loading entry for "${loadable}" to be defined`);
          }

          if (loading)
            ++loadingEntry.counter;
          else if (loadingEntry.counter > 0)
            --loadingEntry.counter;

          return loadingEntry.counter > 0;
        }),
        distinctUntilChanged(),
        shareReplay(1)
      )

    this._loadings$[loadable].subscribe();
  }

  private getLoadable(loadable: Loadable[number], obs: true): (typeof this._loadings$)[string];
  private getLoadable(loadable: Loadable[number], obs?: false): (typeof this._loadings)[string];
  private getLoadable(loadable: Loadable[number], obs: boolean = false) {
    if (!this._loadings[loadable]) this.addLoadable(loadable);

    return obs ? this._loadings$[loadable] : this._loadings[loadable];
  }

  /**
   * Get an observable whose emissions are for each time a loading event has occurred.
   * There is an underlying counter that determines if a loading is currently ongoing,
   * this observable only emits true or false when the counter increases/decreases.
   * @param loadable Loadable resource to get
   * @returns Observable that emits true or false every time a loading event occurs
   */
  getRootObservable(loadable: Loadable[number]) {
    return this._loadings[loadable]?.subj.asObservable();
  }

  /**
   * Underlying counter that determines how many times the loading has started.
   * 0 indicates the loading has not started or has finished.
   * @param loadable Loadable resource to get
   * @returns Number
   */
  getLoadingCounter(loadable: Loadable[number]) {
    return this._loadings[loadable]?.counter || 0;
  }

  /**
   * Wether a resource is currently loading.
   * @param loadable Loadable resource to get
   * @returns Boolean
   */
  isLoading(loadable: Loadable[number]) {
    return this.getLoadingCounter(loadable) > 0;
  }

  /**
   * Notifies that a loading has started for a resource
   * @param loadable Loadable resource to notify
   * @param obs Observable to pipe and return. If provided, the function
   * returns a piped observable that completes the loading automatically on finalize
   * @returns If obs is provided, piped observable using finalize to automatically complete the loading. Otherwise, undefined
   */
  startLoading<T = any>(loadable: Loadable[number], obs?: Observable<T>): Observable<T> | undefined | null {
    this.nextLoading(loadable, true);

    return obs?.pipe(finalize(() => this.completeLoading(loadable)));
  }

  notifyError(loadable: Loadable[number], error: any) {
    this.getLoadable(loadable)?.subj.error(error);
  }

  /**
   * Notifies that a loading has completed
   * @param loadable Loadable resource to notify
   */
  completeLoading(loadable: Loadable[number]) {
    this.nextLoading(loadable, false);
  }

  /**
   * Forces a loading to complete (sets the underlying counter to 0)
   * @param loadable Loadable resource to complete
   */
  forceCompleteLoading(loadable: Loadable[number]) {
    const loadableEntry = this.getLoadable(loadable);

    if (!loadableEntry) {
      return; // If the loadable entry does not exist, do nothing
    }

    loadableEntry.counter = 0;
    this.completeLoading(loadable);
  }

  /**
   * Pipes the original loading observable to allow only start events
   * @param loadable
   * @returns Observable emitting every time the loading emits true
   */
  onStartLoading(loadable: Loadable[number]) {
    const loadableEntry = this.getLoadable(loadable, true);

    if (!loadableEntry) {
      throw new Error(`Expected loading entry for "${loadable}" to be defined`);
    }

    return loadableEntry.pipe(filter((loading) => loading));
  }

  /**
   * Pipes the original loading observable to allow only complete events
   * @param loadable
   * @returns Observable emitting every time the loading emits false
   */
  onCompleteLoading(loadable: Loadable[number]) {
    const loadableEntry = this.getLoadable(loadable, true);

    if (!loadableEntry) {
      throw new Error(`Expected loading entry for "${loadable}" to be defined`);
    }

    return loadableEntry.pipe(filter((loading) => !loading));
  }

  private nextLoading(loadable: Loadable[number], bool: boolean) {
    const loadableEntry = this.getLoadable(loadable);

    if (!loadableEntry) {
      throw new Error(`Expected loading entry for "${loadable}" to be defined`);
    }

    loadableEntry.subj.next(bool);
  }
}
