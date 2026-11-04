// /admin-api/backups (Operação → Backup, permission backups.manage): list, make one now, download,
// restore the course content from one, delete, and the automatic schedule. The work is in
// lib/backups; every mutation writes its audit row in the same D1 batch.
import { ApiError, adminApi } from '@tie/shared';
import type { AppEnv } from '@tie/worker-core';
import { Hono } from 'hono';
import {
  type BackupActor,
  backupObject,
  createBackup,
  deleteBackup,
  listBackups,
  loadBackup,
  nextAutoAt,
  readConfig,
  restoreBackup,
  saveConfig,
} from '../lib/backups';
import { actor, auditStmt, bodyOf, type Ctx, paramsOf, route } from '../lib/http';

const routes = new Hono<AppEnv>();
const api = adminApi.backups;

const staffActor = (c: Ctx): BackupActor => ({
  userId: actor(c).userId,
  audit: (entry, now) => auditStmt(c, entry, now),
});

route(routes, api.list, async (c) => {
  const db = c.env.DB;
  const [items, config] = await Promise.all([listBackups(db), readConfig(db)]);
  return c.json({ items, config, nextAutoAt: nextAutoAt(config) });
});

route(routes, api.create, async (c) => {
  const body = await bodyOf(c, api.create.body);
  const item = await createBackup(c.env, { kind: 'manual', scope: body.scope, note: body.note, actor: staffActor(c) });
  return c.json({ item }, 201);
});

route(routes, api.config, async (c) => {
  const config = await bodyOf(c, api.config.body);
  await saveConfig(c.env.DB, config, staffActor(c));
  return c.json({ config, nextAutoAt: nextAutoAt(config) });
});

/** yyyy-mm-dd-hhmm in São Paulo time (UTC-3), for the download file name. */
function stamp(ms: number): string {
  const d = new Date(ms - 3 * 60 * 60 * 1000).toISOString();
  return `${d.slice(0, 10)}-${d.slice(11, 13)}${d.slice(14, 16)}`;
}

route(routes, api.download, async (c) => {
  const { id } = paramsOf(c, api.download.params);
  const row = await loadBackup(c.env.DB, id);
  if (!row) throw new ApiError('not_found', 'Backup não encontrado.');
  const obj = await backupObject(c.env, row);
  if (!obj) throw new ApiError('not_found', 'O arquivo deste backup não está mais no armazenamento.');
  const name = `tie-backup-${row.scope}-${stamp(row.created_at)}.json.gz`;
  return new Response(obj.body, {
    headers: {
      'Content-Type': 'application/gzip',
      'Content-Length': String(obj.size),
      'Content-Disposition': `attachment; filename="${name}"`,
      'Cache-Control': 'no-store',
    },
  });
});

route(routes, api.restore, async (c) => {
  const { id } = paramsOf(c, api.restore.params);
  const body = await bodyOf(c, api.restore.body);
  const result = await restoreBackup(c.env, id, { removeNew: body.removeNew, actor: staffActor(c) });
  return c.json({ result });
});

route(routes, api.remove, async (c) => {
  const { id } = paramsOf(c, api.remove.params);
  await deleteBackup(c.env, id, staffActor(c));
  return c.json({ ok: true as const });
});

export default routes;
