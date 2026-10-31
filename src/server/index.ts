import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DB_PATH } from './db.js';
import { purgeExpiredSessions, sessionMiddleware } from './auth.js';
import { HttpError } from './errors.js';
import { authRouter } from './routes/auth.js';
import { usersRouter } from './routes/users.js';
import { sitesRouter } from './routes/sites.js';
import { deviceTypesRouter } from './routes/deviceTypes.js';
import { devicesRouter } from './routes/devices.js';
import { connectionsRouter } from './routes/connections.js';
import { vlansRouter } from './routes/vlans.js';
import { miscRouter } from './routes/misc.js';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());
app.use(sessionMiddleware);

app.use('/api', authRouter);
app.use('/api/users', usersRouter);
app.use('/api', sitesRouter);
app.use('/api/device-types', deviceTypesRouter);
app.use('/api', devicesRouter);
app.use('/api/connections', connectionsRouter);
app.use('/api', vlansRouter);
app.use('/api', miscRouter);
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

// Static web app (production build)
const here = path.dirname(fileURLToPath(import.meta.url));
const webDir = path.resolve(here, '../web');
if (fs.existsSync(path.join(webDir, 'index.html'))) {
  app.use(express.static(webDir, { index: false, maxAge: '1h' }));
  app.get('/{*splat}', (_req, res) => res.sendFile(path.join(webDir, 'index.html')));
}

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  const e = err as { code?: string; message?: string; type?: string };
  if (e.code === 'SQLITE_CONSTRAINT_UNIQUE') {
    const field = (e.message ?? '').split(':').pop()?.trim() ?? '';
    return res.status(409).json({ error: `Already exists: ${field.replace(/\w+\./g, '')}` });
  }
  if (e.code?.startsWith('SQLITE_CONSTRAINT')) return res.status(409).json({ error: e.message });
  if (e.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' });
  console.error(err);
  res.status(500).json({ error: 'Internal error' });
});

const port = Number(process.env.PORT ?? 3000);
purgeExpiredSessions();
setInterval(purgeExpiredSessions, 6 * 3600_000).unref();
app.listen(port, () => console.log(`rackdocs listening on http://localhost:${port} (db: ${DB_PATH})`));
