import {
  ChangeDetectionStrategy,
  Component,
  input,
  signal,
} from '@angular/core';
import { GatewayError } from '@portfolio/luna-shopper-admin/data-access';
import { gatewayErrorKey } from '@portfolio/luna-shopper-admin/feature-resource';
import type {
  NamedAction,
  ResourceRow,
} from '@portfolio/luna-shopper-admin/models';
import { ConfirmDialog } from '@portfolio/luna-shopper-admin/ui';

/** Something the operator is being asked about before it happens. */
interface PendingAction {
  readonly heading: string;
  readonly body: string;
  readonly confirm: string;
  /** What to put into the body, which is what makes the question specific. */
  readonly args: Readonly<Record<string, string | number>>;
  /**
   * `primary` for an act that can be undone, so red stays for the ones that
   * cannot.
   */
  readonly tone: 'danger' | 'primary';
  /**
   * A sentence of the page's own for a refusal code, where the generic one
   * would not say what to do.
   */
  readonly refusals: Readonly<Record<string, string>>;
  run(): Promise<void>;
}

/** What a page says about one action it starts. */
export interface ActionOptions {
  /** What to put into the confirmation's body. `name` is the row's title. */
  readonly args?: Readonly<Record<string, string | number>>;
  /**
   * For a named action the default is what its descriptor says: red when it
   * is `danger`, and `primary` when it is not.
   */
  readonly tone?: 'danger' | 'primary';
  readonly refusals?: Readonly<Record<string, string>>;
  /** What follows the action: usually reading the page again. */
  after?(): void | Promise<void>;
}

/**
 * Running the actions a descriptor declares, from a page that is not a list
 * (admin plan 0045).
 *
 * **One place declares an action**: the descriptor's `named` list. The list
 * page has always drawn those. The page of a person and the page of a zone
 * drew a second copy by hand, with its own confirmation keys, and the two
 * copies of kick and ban had begun to say different things. A page hands the
 * descriptor's action to this instead, and this does what the list does with
 * it: ask first where the action says to ask, run it, and say so when the
 * server refuses.
 *
 * **Every action that names a confirmation is confirmed, and none is added.**
 * "Restore" names none, because it is the undo, and it runs on the press.
 *
 * A plain class and not a service: a page holds one, and its state is that
 * page's.
 */
export class ActionRunner {
  /** The action awaiting a yes. */
  readonly asking = signal<PendingAction | null>(null);
  /** Whether an action is in flight, so a second press cannot start another. */
  readonly busy = signal(false);
  /**
   * A key for an action the server refused.
   *
   * The page stays as it was, so this is a line beside the content and never
   * a replacement for it.
   */
  readonly errorKey = signal<string | null>(null);

  /** Start one of a descriptor's actions on a row. */
  start(
    action: NamedAction<ResourceRow>,
    row: ResourceRow,
    options: ActionOptions = {}
  ): void {
    this.ask(
      action.confirm === undefined
        ? null
        : {
            heading: action.confirm.heading,
            body: action.confirm.body,
            confirm: action.confirm.confirm,
          },
      async () => {
        await action.run(row);
        await options.after?.();
      },
      {
        ...options,
        tone: options.tone ?? (isDangerAction(action) ? 'danger' : 'primary'),
      }
    );
  }

  /**
   * Ask, then run. With no question the act runs at once.
   *
   * For an act that is not a named action of a descriptor: a role switch, and
   * a delete, which the descriptor declares as a flag.
   */
  ask(
    question: {
      readonly heading: string;
      readonly body: string;
      readonly confirm: string;
    } | null,
    run: () => Promise<void>,
    options: Omit<ActionOptions, 'after'> = {}
  ): void {
    this.errorKey.set(null);

    const pending: PendingAction = {
      heading: question?.heading ?? '',
      body: question?.body ?? '',
      confirm: question?.confirm ?? '',
      args: options.args ?? {},
      tone: options.tone ?? 'danger',
      refusals: options.refusals ?? {},
      run,
    };

    if (question === null) {
      void this._run(pending);
      return;
    }
    this.asking.set(pending);
  }

  /** The operator said yes. */
  async confirm(): Promise<void> {
    const pending = this.asking();
    if (pending !== null) {
      await this._run(pending);
    }
  }

  dismiss(): void {
    this.asking.set(null);
  }

  private async _run(pending: PendingAction): Promise<void> {
    if (this.busy()) {
      return;
    }

    this.busy.set(true);
    try {
      await pending.run();
    } catch (error) {
      this.errorKey.set(
        error instanceof GatewayError
          ? (pending.refusals[error.code] ??
              gatewayErrorKey(error) ??
              'resource.error.unknown')
          : 'resource.error.unknown'
      );
    } finally {
      this.asking.set(null);
      this.busy.set(false);
    }
  }
}

/**
 * The question an {@link ActionRunner} is asking, drawn.
 *
 * A component of its own so that each page writes one element where it used
 * to write the dialog and its seven bindings.
 */
@Component({
  selector: 'lib-action-confirm',
  imports: [ConfirmDialog],
  template: `
    @if (runner().asking(); as pending) {
      <lib-confirm-dialog
        (confirm)="runner().confirm()"
        (dismiss)="runner().dismiss()"
        [bodyArgs]="pending.args"
        [bodyKey]="pending.body"
        [busy]="runner().busy()"
        [confirmKey]="pending.confirm"
        [headingKey]="pending.heading"
        [tone]="pending.tone"
      />
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ActionConfirm {
  readonly runner = input.required<ActionRunner>();
}

/**
 * Whether an action's button is red.
 *
 * The descriptor says so, with `danger`, and nothing names the actions a
 * second time: the record page reads the same flag, so a menu drawn here and
 * the More menu of a page cannot disagree.
 */
export function isDangerAction(action: { readonly danger?: true }): boolean {
  return action.danger === true;
}
