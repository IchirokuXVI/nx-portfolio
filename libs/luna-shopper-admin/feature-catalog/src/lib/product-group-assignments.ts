import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import {
  ApiUrl,
  RESOURCE_GATEWAYS,
  ResourceMemoryGateways,
  toBulkOperationError,
  toGatewayError,
  type BulkOperationError,
} from '@portfolio/luna-shopper-admin/data-access';
import type { Wire } from '@portfolio/luna-shopper-admin/models';
import { firstValueFrom } from 'rxjs';
import { itemSource, PRODUCT_GROUP_ASSIGNMENTS_PATH } from './catalog-sources';

/**
 * One product to move, and the group it was in when the person reviewed it.
 *
 * `expectedGroupId` is sent as the operation's expectation, so a product that
 * somebody else moved between the review and the press is refused rather than
 * moved again from a place the person never saw.
 */
export interface GroupAssignment {
  readonly itemId: string;
  readonly groupId: string;
  readonly expectedGroupId: string | null;
}

/** What the request did to one product. */
export interface GroupAssignmentOutcome {
  readonly itemId: string;
  readonly applied: boolean;
  /** Why this operation failed, when it is the one that did. */
  readonly error: BulkOperationError | null;
}

/**
 * What one assignments request answered (backend plan 0100).
 *
 * All or nothing: `applied` is the verdict for the whole request, and when it
 * is false no product moved, including the ones whose own line carries no
 * error. `error` is the server's sentence for a refusal no single line caused.
 */
export interface GroupAssignmentAnswer {
  readonly applied: boolean;
  readonly error: string | null;
  readonly results: readonly GroupAssignmentOutcome[];
}

/**
 * Moves many products into groups in one request (admin plan 0035, section 2).
 *
 * `POST /v1/admin/catalog/product-groups/assignments` rather than one edit per
 * product, because the route is one transaction: a batch that fails at the
 * twentieth product leaves the other nineteen where they were, and the answer
 * says which one failed and why.
 *
 * Shaped like `BrandsGateway`: over HTTP when the app bound it, and against the
 * memory item table otherwise, so the screens work with nothing listening.
 */
@Injectable({ providedIn: 'root' })
export class ProductGroupAssignments {
  private readonly _gateways = inject(RESOURCE_GATEWAYS);
  private readonly _http = inject(HttpClient, { optional: true });
  private readonly _urls = inject(ApiUrl, { optional: true });

  async assign(
    assignments: readonly GroupAssignment[]
  ): Promise<GroupAssignmentAnswer> {
    if (this._gateways instanceof ResourceMemoryGateways) {
      return this._assignInMemory(assignments);
    }
    const http = this._http;
    const urls = this._urls;
    if (http === null || urls === null) {
      throw new Error(
        'ProductGroupAssignments needs HttpClient and ApiUrl when the gateways are not in memory.'
      );
    }

    const body: Wire.ApplyProductGroupAssignmentsDto = {
      operations: assignments.map((assignment) => ({
        op: 'assignItem',
        itemId: assignment.itemId,
        groupId: assignment.groupId,
        expect: { productGroupId: assignment.expectedGroupId },
      })),
    };

    let answer: unknown;
    try {
      answer = await firstValueFrom(
        http.post<unknown>(urls.gateway(PRODUCT_GROUP_ASSIGNMENTS_PATH), body)
      );
    } catch (error) {
      throw toGatewayError(error);
    }
    return toGroupAssignmentAnswer(answer, assignments);
  }

  /**
   * The same rule against the memory table: every expectation is checked
   * before anything moves, and one mismatch refuses the whole request.
   */
  private async _assignInMemory(
    assignments: readonly GroupAssignment[]
  ): Promise<GroupAssignmentAnswer> {
    const items = this._gateways.for<Wire.CatalogItemView>(itemSource());
    const checked: GroupAssignmentOutcome[] = [];

    for (const assignment of assignments) {
      let error: BulkOperationError | null = null;
      try {
        const item = await items.read(assignment.itemId);
        if ((item.productGroupId ?? null) !== assignment.expectedGroupId) {
          error = {
            code: 'EXPECT_MISMATCH',
            detail: `Item ${assignment.itemId} is no longer in the group it was reviewed in.`,
          };
        }
      } catch {
        error = {
          code: 'NOT_FOUND',
          detail: `Item ${assignment.itemId} does not exist.`,
        };
      }
      checked.push({ itemId: assignment.itemId, applied: false, error });
    }

    if (checked.some((line) => line.error !== null)) {
      return { applied: false, error: null, results: checked };
    }

    for (const assignment of assignments) {
      await items.update(assignment.itemId, {
        productGroupId: assignment.groupId,
      });
    }
    return {
      applied: true,
      error: null,
      results: checked.map((line) => ({ ...line, applied: true })),
    };
  }
}

/**
 * An assignments answer, read from `unknown` (rule D4).
 *
 * Lines are matched to what was sent by item id, and by position when a line
 * names none. A product the answer does not mention reads as not applied,
 * which is the reading that never claims a move that did not happen.
 */
export function toGroupAssignmentAnswer(
  answer: unknown,
  sent: readonly GroupAssignment[]
): GroupAssignmentAnswer {
  const record =
    typeof answer === 'object' && answer !== null
      ? (answer as Record<string, unknown>)
      : {};
  const raw = Array.isArray(record['results'])
    ? (record['results'] as unknown[])
    : [];
  const lines = raw.map((entry) =>
    typeof entry === 'object' && entry !== null
      ? (entry as Record<string, unknown>)
      : {}
  );
  const applied = record['applied'] === true;

  return {
    applied,
    error: typeof record['error'] === 'string' ? record['error'] : null,
    results: sent.map((assignment, index) => {
      const line =
        lines.find((entry) => entry['itemId'] === assignment.itemId) ??
        lines[index] ??
        {};
      return {
        itemId: assignment.itemId,
        applied: applied && line['applied'] === true,
        error: toBulkOperationError(line['error']),
      };
    }),
  };
}
