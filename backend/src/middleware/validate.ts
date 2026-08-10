/**
 * Request validation.
 *
 * A route declares Zod schemas for whichever of body / params / query it
 * accepts; anything not declared is not read by the handler. All three are
 * checked in one pass so a caller gets every problem back at once instead of
 * fixing them one request at a time.
 *
 * Parsed output lands on `req.validated`, never back onto `req.body` — see
 * types/express.d.ts for why.
 *
 * Controllers read it with a single cast:
 *
 *     const input = req.validated.body as LoginInput;
 *
 * The cast is safe because the route that reaches the controller is the route
 * that declared the schema, and `LoginInput` is inferred from that same schema
 * (`z.infer<typeof loginSchema>`), so the two cannot drift apart.
 */
import type { RequestHandler } from 'express';
import { ZodError, type ZodTypeAny } from 'zod';
import { BadRequestError, ValidationError, type ErrorDetail } from '../utils/AppError';

export interface RequestSchemas {
  body?: ZodTypeAny;
  params?: ZodTypeAny;
  query?: ZodTypeAny;
}

type Source = keyof RequestSchemas;

/** Prefixes each issue with the part of the request it came from. */
function toDetails(source: Source, error: ZodError): ErrorDetail[] {
  return error.issues.map((issue) => ({
    field: issue.path.length > 0 ? `${source}.${issue.path.join('.')}` : source,
    message: issue.message,
  }));
}

export function validate(schemas: RequestSchemas): RequestHandler {
  return (req, _res, next) => {
    const details: ErrorDetail[] = [];
    const validated = { body: undefined, params: undefined, query: undefined } as {
      body: unknown;
      params: unknown;
      query: unknown;
    };

    for (const source of ['body', 'params', 'query'] as const) {
      const schema = schemas[source];
      if (!schema) continue;

      const result = schema.safeParse(req[source]);
      if (result.success) {
        validated[source] = result.data;
      } else {
        details.push(...toDetails(source, result.error));
      }
    }

    if (details.length > 0) {
      // A bad path parameter means the URL itself is wrong — /customers/abc is
      // not a resource address at all — so it is a 400. A well-formed request
      // whose body or query fails a rule is a 422. This split is the contract
      // published in docs/API_PLAN.md section 1.
      const isPathProblem = details.some((detail) => detail.field.startsWith('params'));

      next(
        isPathProblem
          ? new BadRequestError('Invalid URL parameter.', details)
          : new ValidationError('Request validation failed.', details),
      );
      return;
    }

    req.validated = validated;
    next();
  };
}
