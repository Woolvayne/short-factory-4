import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const API_MODULES: Record<string, string> = {
  '/api/auth': 'api/auth.js',
  '/api/buffer': 'api/buffer.js',
  '/api/upload': 'api/upload.js',
  '/api/tts': 'api/tts.js',
};

export function localApi(): Plugin {
  return {
    name: 'local-api',
    configureServer(server) {
      server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next) => {
        const endpoint = req.url?.split('?')[0];
        const apiModule = endpoint ? API_MODULES[endpoint] : undefined;
        if (!apiModule) return next();
        try {
          // API routes are pure JSON — no binary passthrough.
          const maxBytes = 1024 * 1024;
          let raw = '';
          let total = 0;
          for await (const chunk of req) {
            total += chunk.length;
            if (total > maxBytes) { res.statusCode = 413; res.end('Request too large'); return; }
            raw += chunk;
          }
          const parsedBody = raw ? JSON.parse(raw) : undefined;
          const request = Object.assign(req, { body: parsedBody });
          const response = Object.assign(res, {
            status(code: number) { res.statusCode = code; return response; },
            json(data: unknown) { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(data)); return response; },
          });
          const modulePath = pathToFileURL(path.join(server.config.root, apiModule)).href;
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
