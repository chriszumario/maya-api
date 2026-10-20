import { Elysia } from 'elysia';
import { configure, getConsoleSink, getJsonLinesFormatter, getLogger } from '@logtape/logtape';
import { isDev } from './env';

const level = isDev ? 'debug' : 'info';

await configure({
  sinks: {
    console: getConsoleSink({
      formatter: isDev ? undefined : getJsonLinesFormatter(),
    }),
  },
  loggers: [
    {
      category: ['maya'],
      sinks: ['console'],
      lowestLevel: level,
    },
    { category: ['logtape', 'meta'], sinks: ['console'], lowestLevel: 'warning' },
  ],
});

export const logger = getLogger(['maya']);

const requests = new WeakMap<Request, { startedAt: number; requestId: string }>();

// Never serialize provider errors: their messages and causes can contain credentials or SQL values.
export function errorDetails(error: unknown) {
  return { errorType: error instanceof Error ? error.constructor.name : 'UnknownError' };
}

export const httpLogger = (app: Elysia) =>
  app
    .onRequest(({ request, set }) => {
      const incomingId = request.headers.get('x-request-id');
      const requestId =
        incomingId && /^[A-Za-z0-9_-]{1,128}$/.test(incomingId) ? incomingId : Bun.randomUUIDv7();
      requests.set(request, { startedAt: Bun.nanoseconds(), requestId });
      set.headers['x-request-id'] = requestId;
    })
    .onAfterResponse('global', ({ request, route, path, set, responseValue }) => {
      const timing = requests.get(request);
      if (!timing || path === '/') return;
      const registeredPath = route ?? app.routes.find((candidate) => candidate.path === path)?.path;
      logger.info('HTTP {method} {route} {status} ({durationMs} ms)', {
        requestIdHash: Bun.CryptoHasher.hash('sha256', timing.requestId, 'hex'),
        method: request.method,
        route: registeredPath ?? '[unmatched]',
        status: responseValue instanceof Response ? responseValue.status : (set.status ?? 200),
        durationMs: (Bun.nanoseconds() - timing.startedAt) / 1_000_000,
      });
    });
