import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

export function localApi(): Plugin {
  return {
    name: 'local-api',
    configureServer(server) {
      server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next) => {
        const endpoint = req.url?.split('?')[0];
        if (endpoint !== '/api/buffer' && endpoint !== '/api/tts') return next();
        try {
          let raw = '';
          for await (const chunk of req) {
            raw += chunk;
            if (Buffer.byteLength(raw) > 1024 * 1024) { res.statusCode = 413; res.end('Request too large'); return; }
          }
          const request = Object.assign(req, { body: raw ? JSON.parse(raw) : undefined });
          const response = Object.assign(res, {
            status(code: number) { res.statusCode = code; return response; },
            json(data: unknown) { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(data)); return response; },
          });
          const modulePath = pathToFileURL(path.join(server.config.root, endpoint === '/api/buffer' ? 'api/buffer.js' : 'api/tts.js')).href;
          const { default: handler } = await import(modulePath);
          await handler(request, response);
        } catch {
          if (!res.headersSent) { res.statusCode = 500; res.setHeader('Content-Type', 'application/json'); }
          res.end(JSON.stringify({ error: 'Local API request failed', uncertain: true }));
        }
      });
    },
  };
}
