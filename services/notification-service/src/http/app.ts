import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import type { Identity, TokenVerifier } from '../auth/verifier.ts';
import { log } from '../log.ts';
import { verifyWebhook } from '../webhooks/signature.ts';

export interface AppDeps {
  verifyToken: TokenVerifier;
  /** Key bytes of the dispatcher's whsec_ signing secret. */
  webhookKey: Buffer;
  /** Current time in seconds; the tests pass a fixed clock. */
  nowSeconds?: () => number;
}

function error(res: Response, status: number, code: string, message: string): void {
  res.status(status).json({ error: code, message });
}

function notImplemented(_req: Request, res: Response): void {
  error(res, 501, 'not_implemented', 'This endpoint is planned and not implemented yet.');
}

/** The caller's identity, set by the authenticate middleware. */
export function identity(res: Response): Identity {
  return res.locals['identity'] as Identity;
}

export function createApp(deps: AppDeps): Express {
  const now = deps.nowSeconds ?? (() => Math.floor(Date.now() / 1000));
  const app = express();
  app.disable('x-powered-by');

  // Logs method, route, status and duration only: no headers, tokens, bodies or user ids.
  app.use((req, res, next) => {
    const start = performance.now();
    res.on('finish', () => {
      log.info('request', {
        method: req.method,
        route: (req.route as { path?: string } | undefined)?.path ?? 'unmatched',
        status: res.statusCode,
        duration_ms: Math.round(performance.now() - start),
      });
    });
    next();
  });

  const authenticate = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const match = /^Bearer\s+(\S+)$/i.exec(req.get('Authorization') ?? '');
    if (!match?.[1]) {
      res.set('WWW-Authenticate', 'Bearer realm="notification-service"');
      return error(res, 401, 'unauthorized', 'missing bearer token');
    }
    try {
      res.locals['identity'] = await deps.verifyToken(match[1]);
    } catch {
      res.set('WWW-Authenticate', 'Bearer realm="notification-service"');
      return error(res, 401, 'unauthorized', 'invalid token');
    }
    next();
  };

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // Dispatcher webhooks: only a valid Standard Webhooks signature within the tolerance gets past
  // this point. The raw body is kept as text, because the signature covers its exact bytes.
  // Processing (inbox, email) arrives with roadmap step 4.
  app.post('/events', express.text({ type: () => true, limit: '256kb' }), (req, res) => {
    const check = verifyWebhook(
      deps.webhookKey,
      {
        id: req.get('webhook-id'),
        timestamp: req.get('webhook-timestamp'),
        signature: req.get('webhook-signature'),
      },
      typeof req.body === 'string' ? req.body : '',
      now(),
    );
    if (!check.ok) {
      log.warn('webhook rejected', { reason: check.reason });
      return error(res, 401, 'unauthorized', 'invalid webhook signature');
    }
    notImplemented(req, res);
  });

  // Planned endpoint: authenticated now, implemented by a later change (roadmap step 5).
  app.post('/sandbox/reset', authenticate, notImplemented);

  // Known paths with another method answer 405, everything else 404; errors never leak details.
  app.all(['/health', '/events', '/sandbox/reset'], (_req, res) => {
    error(res, 405, 'method_not_allowed', 'Method not allowed.');
  });
  app.use((_req, res) => {
    error(res, 404, 'not_found', 'No such route.');
  });
  app.use((err: Error & { status?: number; type?: string }, _req: Request, res: Response, _next: NextFunction) => {
    if (err.type === 'entity.too.large') {
      return error(res, 413, 'payload_too_large', 'Request body too large.');
    }
    log.error('unhandled error', { error: err.message });
    error(res, 500, 'internal_error', 'Internal error.');
  });

  return app;
}
