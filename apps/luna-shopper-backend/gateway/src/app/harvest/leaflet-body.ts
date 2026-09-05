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
 * The gateway's JSON body limits (plan 0081, section 7).
 *
 * ## Why the app is created with `bodyParser: false`
 *
 * Nest's built in parser is one global `express.json()` at a limit the app
 * cannot vary per route, and its default is 100 KB. This gateway configured
 * none, so **every real leaflet was refused with a bare 413** on a route that
 * had not been written yet. Turning the built in parser off and mounting the
 * parsers by hand is the only way to give one route a larger body than the rest
 * of the surface, and giving the whole surface a 2 MB limit to accommodate one
 * upload is the thing not to do.
 *
 * ## Why the refusal is written out
 *
 * `voice-recording.interceptor.ts` is the precedent, and section 5 of plan 0041
 * is the rule it follows: a refusal has to say the number. Express raises
 * `entity.too.large` from inside the parser, before Nest's router and therefore
 * before Nest's exception filter, so the house problem document is built here
 * instead of being inherited.
 */

/** Where the leaflet upload lives, and the one path with its own limit. */
export const LEAFLET_UPLOAD_PATH = '/v1/admin/harvest/leaflets';

/**
 * Mount the parsers, largest path first.
 *
 * Order is load bearing: `express.json` sets `req._body` and every later parser
 * returns immediately, so the route specific parser has to run before the
 * default one or the default limit wins.
 */
export function jsonBodyParsers(options: {
  leafletMaxBytes: number;
  defaultMaxBytes: number;
}): { path: string | null; handler: RequestHandler }[] {
  return [
    {
      path: LEAFLET_UPLOAD_PATH,
      handler: json({ limit: options.leafletMaxBytes }),
    },
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
  leafletMaxBytes: number;
  defaultMaxBytes: number;
}): (error: unknown, req: Request, res: Response, next: NextFunction) => void {
  return (error, req, res, next) => {
    const type = (error as { type?: string } | null)?.type;
    if (type !== 'entity.too.large' && type !== 'entity.parse.failed') {
      next(error as Error);
      return;
    }

    const isLeaflet = req.path?.startsWith(LEAFLET_UPLOAD_PATH) === true;
    const limit = isLeaflet ? options.leafletMaxBytes : options.defaultMaxBytes;
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
 * A byte count as somebody would say it. "2097152 bytes" is a number nobody can
 * compare against the file they just dropped.
 */
export function describeBytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return mb >= 0.1 ? `${mb.toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`;
}
