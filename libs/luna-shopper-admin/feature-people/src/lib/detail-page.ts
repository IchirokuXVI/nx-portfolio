import { inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { RokuTranslatorService } from '@portfolio/localization/rokutranslator-angular';
import { GatewayError } from '@portfolio/luna-shopper-admin/data-access';
import {
  gatewayErrorKey,
  RESOURCE_DESCRIPTOR,
  RESOURCE_ID_PARAM,
} from '@portfolio/luna-shopper-admin/feature-resource';
import type { ResourceRow } from '@portfolio/luna-shopper-admin/models';

/** Something the operator is being asked about before it happens. */
export interface PendingConfirm {
  readonly heading: string;
  readonly body: string;
  readonly confirm: string;
  /** What to interpolate into the body, which is what makes it specific. */
  readonly args: Readonly<Record<string, string | number>>;
  run(): Promise<void>;
}

/**
 * What the four people detail screens have in common (plan 0007, sections 1
 * and 5).
 *
 * Reading one row off the route, holding the three states that read has, and
 * asking before anything irreversible happens. The screens themselves differ
 * completely in what they draw, which is why they are four components and not a
 * descriptor, but none of them should be inventing its own answer to "what does
 * a failed read look like" or "was this confirmed".
 *
 * **Every action here is confirmed, and the confirmation names the thing.**
 * Each one is destructive or hard to reverse and several are irreversible, so
 * the question is never generic: deleting an account says whose, and says what
 * goes with it.
 *
 * A plain class rather than a component, extended by the four. It calls `inject`
 * in field initializers, which run while the subclass is being constructed and
 * therefore inside an injection context.
 */
export abstract class DetailPage<T extends ResourceRow> {
  protected readonly route = inject(ActivatedRoute);
  protected readonly router = inject(Router);
  protected readonly translator = inject(RokuTranslatorService);

  /** The resource this screen is for, from route `data`, as the list page reads it. */
  readonly descriptor = this.route.snapshot.data[RESOURCE_DESCRIPTOR];

  /** Built here because a field initializer is an injection context. */
  private readonly _gateway = this.descriptor.gateway();

  readonly id = this.route.snapshot.paramMap.get(RESOURCE_ID_PARAM) ?? '';

  readonly row = signal<T | null>(null);
  readonly loading = signal(true);
  /** A key for a failed read, which replaces the whole screen. */
  readonly errorKey = signal<string | null>(null);

  /** The action awaiting a yes. */
  readonly asking = signal<PendingConfirm | null>(null);
  /** Whether an action is in flight, so a second click cannot start another. */
  readonly busy = signal(false);
  /**
   * A key for a failed **action**, which is not the same as a failed read.
   *
   * A read that fails leaves nothing to look at, so it takes the screen. An
   * action that fails leaves the screen exactly as it was, so it is a line
   * beside the content rather than a replacement for it.
   */
  readonly actionErrorKey = signal<string | null>(null);

  /** The interface locale, for every `Intl` call these screens make. */
  get locale(): string {
    return this.translator.locale();
  }

  /** Read the row again, from the top. */
  async load(): Promise<void> {
    this.loading.set(true);
    this.errorKey.set(null);

    try {
      this.row.set((await this._gateway.read(this.id)) as T);
    } catch (error) {
      this.row.set(null);
      this.errorKey.set(
        gatewayErrorKey(error instanceof GatewayError ? error : null)
      );
    } finally {
      this.loading.set(false);
    }
  }

  /** Back to this resource's list, one segment up. */
  back(): void {
    void this.router.navigate(['..'], { relativeTo: this.route });
  }

  /**
   * Open this row's form.
   *
   * `edit` beside `:id`, which is the route the factory declares for a resource
   * that has both a detail component of its own and `edit: true`. Without that
   * second route the generic form would have nowhere to be reached, because
   * `detail` wins at `:id` (plan 0009, section 1).
   */
  edit(): void {
    void this.router.navigate(['edit'], { relativeTo: this.route });
  }

  /** Whether this screen offers a way to change the row it is showing. */
  get canEdit(): boolean {
    return this.descriptor.actions?.edit === true;
  }

  ask(pending: PendingConfirm): void {
    this.actionErrorKey.set(null);
    this.asking.set(pending);
  }

  /**
   * The operator said yes.
   *
   * The row is read again afterwards rather than patched from what the action
   * returned. An action reaches a service that maintains invariants across
   * several tables, so what it changed is not something this screen can work
   * out, and a screen that guessed would be showing something that is not there.
   */
  async confirm(): Promise<void> {
    const pending = this.asking();
    if (pending === null) {
      return;
    }

    this.busy.set(true);
    try {
      await pending.run();
      this.asking.set(null);
      await this.load();
    } catch (error) {
      this.asking.set(null);
      this.actionErrorKey.set(
        gatewayErrorKey(error instanceof GatewayError ? error : null)
      );
    } finally {
      this.busy.set(false);
    }
  }

  /** Go somewhere else in the back office, by absolute path. */
  go(segments: readonly string[]): void {
    void this.router.navigate(segments);
  }
}

/**
 * A row's own value, when it is missing and an id is the honest fallback.
 *
 * The rule from plan 0007, section 4: where an id does not resolve, because a
 * user was reaped or a race was lost, the screen renders the id. A missing name
 * is not an error state.
 */
export function nameOrId(name: string | null, id: string | null): string {
  if (name !== null && name !== '') {
    return name;
  }
  return id ?? '';
}
