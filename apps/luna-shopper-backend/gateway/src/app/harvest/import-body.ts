import {
  buildProblemDetails,
  ERROR_CODES,
  getRequestContext,
  PROBLEM_JSON_CONTENT_TYPE,
} from '@portfolio/luna-shopper/platform';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { json, urlencoded } from 'express';
import { randomUUID } from 'node:crypto';

/**
 * The gateway's JSON body limits (plan 0081, section 7; plan 0086, section 10).
 *
 * ## Why the app is created with `bodyParser: false`
 *
 * Nest's built in parser is one global `express.json()` at a limit the app
 * cannot vary per route, and its default is 100 KB. This gateway configured
 * none, so **every real leaflet was refused with a bare 413** on a route that
 * had not been written yet. Turning the built in parser off and mounting the
 * parsers by hand is the only way to give one route a larger body than the rest
 * of the surface, and giving the whole surface a multi megabyte limit to
 * accommodate one upload is the thing not to do.
 *
 * ## Why the refusal is written out
 *
 * `voice-recording.interceptor.ts` is the precedent, and section 5 of plan 0041
 * is the rule it follows: a refusal has to say the number. Express raises
 * `entity.too.large` from inside the parser, before Nest's router and therefore
 * before Nest's exception filter, so the house problem document is built here
 * instead of being inherited.
 */

/** Where the file import lives, the largest body this gateway accepts. */
export const IMPORT_UPLOAD_PATH = '/v1/admin/harvest/imports';

/**
 * The three bulk decision routes of plan 0100, which need a body of their own.
 *
 * **Without this the cap on those routes is unreachable.** A file of a thousand
 * operations is a few hundred kilobytes, and the default limit is 100 KB, so
 * every file anywhere near the documented maximum would be refused by the
 * parser before the route ever counted its operations. The refusal would say
 * the body was too large, which is true and useless: the operator's file is
 * inside the limit the route publishes.
 *
 * Smaller than the import limit on purpose. A decisions file carries ids and
 * short names, never the raw text of a leaflet page.
 */
export const BULK_DECISION_PATHS = [
  '/v1/admin/harvest/entries/decisions',
  '/v1/admin/catalog/items/batch',
  '/v1/admin/catalog/product-groups/assignments',
] as const;

/**
 * Mount the parsers, largest path first.
 *
 * Order is load bearing: `express.json` sets `req._body` and every later parser
 * returns immediately, so the route specific parser has to run before the
 * default one or the default limit wins.
 */
export function jsonBodyParsers(options: {
  importMaxBytes: number;
  bulkMaxBytes: number;
  defaultMaxBytes: number;
}): { path: string | null; handler: RequestHandler }[] {
  return [
    {
      path: IMPORT_UPLOAD_PATH,
      handler: json({ limit: options.importMaxBytes }),
    },
    ...BULK_DECISION_PATHS.map((path) => ({
      path,
      handler: json({ limit: options.bulkMaxBytes }),
    })),
    { path: null, handler: json({ limit: options.defaultMaxBytes }) },
    {
      path: null,
      handler: urlencoded({ extended: true, limit: options.defaultMaxBytes }),
    },
  ];
}

/**
 * Turn a body parser's own failures into the house envelope.
 *
 * Registered after the parsers and before the router, which is where an Express
 * error handler catches what they throw. Two cases are worth a sentence of
 * their own: a body over the limit, which names the limit, and a body that is
 * not JSON, which says so rather than becoming a 500.
 */
export function bodyParserProblems(options: {
  importMaxBytes: number;
  bulkMaxBytes: number;
  defaultMaxBytes: number;
}): (error: unknown, req: Request, res: Response, next: NextFunction) => void {
  return (error, req, res, next) => {
    const type = (error as { type?: string } | null)?.type;
    if (type !== 'entity.too.large' && type !== 'entity.parse.failed') {
      next(error as Error);
      return;
    }

    const limit = limitFor(req.path ?? '', options);
    const detail =
      type === 'entity.too.large'
        ? `That body is too large. The limit on this route is ${describeBytes(limit)}.`
        : 'That body could not be read as JSON.';

    // 400 and `validation_failed`, which is the house answer for an upload over
    // a cap: the global filter already maps a multipart 413 to exactly this, and
    // one refusal shape for two routes that refuse the same thing is worth more
    // than the extra status code.
    const problem = buildProblemDetails({
      code: ERROR_CODES.VALIDATION_FAILED,
      correlationId: getRequestContext()?.correlationId ?? randomUUID(),
      detail,
    });
    res.status(problem.status).type(PROBLEM_JSON_CONTENT_TYPE).send(problem);
  };
}

/**
 * Which limit the path that was refused actually had.
 *
 * The same order the parsers are mounted in, and it has to stay that way: a
 * message naming a limit the route does not have sends the operator to trim a
 * file that was never too big.
 */
function limitFor(
  path: string,
  options: {
    importMaxBytes: number;
    bulkMaxBytes: number;
    defaultMaxBytes: number;
  }
): number {
  if (path.startsWith(IMPORT_UPLOAD_PATH)) {
    return options.importMaxBytes;
  }
  if (BULK_DECISION_PATHS.some((bulk) => path.startsWith(bulk))) {
    return options.bulkMaxBytes;
  }
  return options.defaultMaxBytes;
}

/**
 * A byte count as somebody would say it. "2097152 bytes" is a number nobody can
 * compare against the file they just dropped.
 */
export function describeBytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return mb >= 0.1 ? `${mb.toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`;
}
