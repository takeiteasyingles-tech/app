// node:http static server for prototipo/ (read-only), with Range support for the audio/video files.
// Binds 127.0.0.1 only. /api/* answers 404 (the harness routes /api/health to {ai:false} anyway), so
// the prototype always runs in demo mode, exactly like the new app under the harness.
import { createReadStream, statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';
import { PROTO_DIR } from './config';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.woff2': 'font/woff2',
  '.pdf': 'application/pdf',
};

export interface StaticServer {
  url: string;
  close(): Promise<void>;
}

export function servePrototype(port: number, root: string = PROTO_DIR): Promise<StaticServer> {
  const server: Server = createServer((req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://x');
      let path = decodeURIComponent(url.pathname);
      if (path.startsWith('/api/')) {
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end('{"error":"not_found"}');
        return;
      }
      if (path.endsWith('/')) path += 'index.html';
      const file = normalize(join(root, path));
      if (!file.startsWith(normalize(root) + sep)) {
        res.writeHead(404).end();
        return;
      }
      let st: ReturnType<typeof statSync>;
      try {
        st = statSync(file);
        if (!st.isFile()) throw new Error('not a file');
      } catch {
        res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
        return;
      }
      const type = MIME[extname(file).toLowerCase()] ?? 'application/octet-stream';
      const headers: Record<string, string | number> = {
        'content-type': type,
        'cache-control': 'no-store',
        'accept-ranges': 'bytes',
      };
      const range = req.headers.range && /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
      if (range) {
        const size = st.size;
        let start = range[1] ? Number(range[1]) : NaN;
        let end = range[2] ? Number(range[2]) : size - 1;
        if (Number.isNaN(start)) {
          start = Math.max(0, size - end);
          end = size - 1;
        }
        end = Math.min(end, size - 1);
        if (start > end || start >= size) {
          res.writeHead(416, { 'content-range': `bytes */${size}` }).end();
          return;
        }
        res.writeHead(206, {
          ...headers,
          'content-range': `bytes ${start}-${end}/${size}`,
          'content-length': end - start + 1,
        });
        if (req.method === 'HEAD') return void res.end();
        createReadStream(file, { start, end }).pipe(res);
        return;
      }
      res.writeHead(200, { ...headers, 'content-length': st.size });
      if (req.method === 'HEAD') return void res.end();
      createReadStream(file).pipe(res);
    } catch (err) {
      res.writeHead(500).end(String(err));
    }
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () =>
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () =>
          new Promise<void>((r) => {
            server.closeAllConnections();
            server.close(() => r());
          }),
      }),
    );
  });
}
