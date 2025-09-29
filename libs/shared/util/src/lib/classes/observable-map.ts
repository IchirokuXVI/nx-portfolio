import { map, merge, Subject } from 'rxjs';

export class ObservableMap<K, V> extends Map<K, V> {
  public onAdd$ = new Subject<{ key: K; value: V }>();
  public onUpdate$ = new Subject<{ key: K; value: V }>();
  public onDelete$ = new Subject<{ key: K; value: V }>();
  public onChange$ = merge(
    this.onAdd$.pipe(map((data) => ({ type: 'add' as const, ...data }))),
    this.onUpdate$.pipe(map((data) => ({ type: 'update' as const, ...data }))),
    this.onDelete$.pipe(map((data) => ({ type: 'delete' as const, ...data })))
  );

  constructor() {
    super();
  }

  override set(key: K, value: V): this {
    const alreadyHas = this.has(key);

    super.set(key, value);

    if (!alreadyHas) {
      this.onAdd$.next({ key, value });
    } else {
      this.onUpdate$.next({ key, value });
    }

    return this;
  }

  override delete(key: K): boolean {
    const data = this.get(key) as V;

    const result = super.delete(key);

    if (result) {
      this.onDelete$.next({ key, value: data });
    }

    return result;
  }
}
