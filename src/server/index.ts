import './nodeCheck.js';
import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DB_PATH, db } from './db.js';
import { purgeExpiredSessions, sessionMiddleware } from './auth.js';
import { HttpError } from './errors.js';
import { authRouter } from './routes/auth.js';
import { usersRouter } from './routes/users.js';
import { locationsRouter } from './routes/locations.js';
import { devicesRouter } from './routes/devices.js';
import { connectionsRouter } from './routes/connections.js';
import { networksRouter } from './routes/networks.js';
import { libraryRouter } from './routes/library.js';
import { miscRouter } from './routes/misc.js';
import { aiRouter } from './routes/ai.js';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());
app.use(sessionMiddleware);

app.use('/api', authRouter);
app.use('/api/users', usersRouter);
app.use('/api', locationsRouter);
app.use('/api', devicesRouter);
app.use('/api', connectionsRouter);
app.use('/api', networksRouter);
app.use('/api', libraryRouter);
app.use('/api', miscRouter);
app.use('/api', aiRouter);
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

const here = path.dirname(fileURLToPath(import.meta.url));
const webDir = path.resolve(here, '../web');
if (fs.existsSync(path.join(webDir, 'index.html'))) {
  app.use(express.static(webDir, { index: false, maxAge: '1h' }));
  app.get('/{*splat}', (_req, res) => res.sendFile(path.join(webDir, 'index.html')));
}

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  const e = err as { code?: string; message?: string; type?: string; name?: string };
  const msg = e.message ?? '';
  if (/UNIQUE constraint failed/.test(msg)) {
    const field = msg.split(':').pop()?.trim() ?? '';
    return res.status(409).json({ error: `Already exists: ${field.replace(/\w+\./g, '').replace(/COALESCE\(room_id, 0\)/, 'room')}` });
  }
  if (e.name === 'SQLite3Error' && /constraint failed/i.test(msg)) return res.status(409).json({ error: msg });
  if (e.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' });
  if (e.type === 'entity.too.large') return res.status(413).json({ error: 'File is too large' });
  console.error(err);
  res.status(500).json({ error: 'Internal error' });
});

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '0.0.0.0';
purgeExpiredSessions();
setInterval(purgeExpiredSessions, 6 * 3600_000).unref();
const server = app.listen(port, host, () => console.log(`rackdocs listening on http://${host}:${port} (db: ${DB_PATH})`));

let shuttingDown = false;
function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received, shutting down`);
  const timer = setTimeout(() => { console.error('Shutdown timed out, forcing exit'); process.exit(1); }, 3000);
  timer.unref();
  server.close(() => { try { db.close(); } catch (e) { console.error('Error closing database', e); } process.exit(0); });
  server.closeAllConnections();
}
for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => shutdown(sig));
