import { z } from 'zod';
import { BACKUP } from '../constants';
import { IdParams, Ok, Timestamp } from './common';
import { endpoint } from './http';

// Backups (tie-admin, Operação → Backup). A backup is a gzip JSON dump of D1 tables stored in R2
// (BACKUP_R2_PREFIX, private: it only leaves through the download route) and indexed in the backups
// table (migration 0010). Made by hand, by the hourly cron when the schedule is due, by an agent
// (MCP create_backup) and automatically right before every restore.
//
// Restore puts the COURSE CONTENT of a backup back into the draft tables (content scope tables; a
// full backup holds them too). It upserts the backup's rows and, when asked, removes content rows
// created after the backup unless learner data still points at them. Learners see nothing until a
// release is published. User data is never restored through the API: a full backup is for disaster
// recovery (download it, see docs/DEPLOY.md).

export const BACKUP_SCOPES = ['content', 'full'] as const;
export const BackupScope = z.enum(BACKUP_SCOPES);
export type BackupScope = z.infer<typeof BackupScope>;

export const BACKUP_KINDS = ['manual', 'auto', 'pre_restore', 'agent'] as const;
export const BackupKind = z.enum(BACKUP_KINDS);
export type BackupKind = z.infer<typeof BackupKind>;

export const BackupStatus = z.enum(['ok', 'failed']);
export type BackupStatus = z.infer<typeof BackupStatus>;

export const BackupRow = z.object({
  id: z.string(),
  kind: BackupKind,
  scope: BackupScope,
  status: BackupStatus,
  /** Compressed size in R2. */
  sizeBytes: z.int().min(0),
  tables: z.int().min(0),
  rows: z.int().min(0),
  note: z.string().nullable(),
  error: z.string().nullable(),
  createdBy: z.string().nullable(),
  createdAt: Timestamp,
  /** Last time content was restored from this backup. */
  restoredAt: Timestamp.nullable(),
});
export type BackupRow = z.infer<typeof BackupRow>;

export const BACKUP_FREQUENCIES = ['off', 'daily', 'weekly'] as const;
export const BackupFrequency = z.enum(BACKUP_FREQUENCIES);

/** The automatic schedule (app_settings['backup.config']). Hours and weekdays are São Paulo time. */
export const BackupConfig = z.strictObject({
  frequency: BackupFrequency,
  /** 0..23. */
  hour: z.int().min(0).max(23),
  /** 0 = Sunday … 6 = Saturday (weekly only). */
  weekday: z.int().min(0).max(6),
  scope: BackupScope,
  /** Automatic backups kept; older ones are deleted after each automatic run. Manual ones stay. */
  keep: z.int().min(BACKUP.keepMin).max(BACKUP.keepMax),
});
export type BackupConfig = z.infer<typeof BackupConfig>;

export const DEFAULT_BACKUP_CONFIG: BackupConfig = { frequency: 'daily', hour: 3, weekday: 0, scope: 'full', keep: 14 };

export const CreateBackupBody = z.strictObject({
  scope: BackupScope.default('full'),
  note: z.string().trim().max(BACKUP.noteMax).optional(),
});
export type CreateBackupBody = z.infer<typeof CreateBackupBody>;

export const RestoreBackupBody = z.strictObject({
  /** Also delete content rows created after the backup (kept when learner data uses them). */
  removeNew: z.boolean().default(true),
});

export const RestoreResult = z.object({
  /** The content backup taken right before the restore (undo = restore it). */
  safetyBackupId: z.string(),
  tables: z.int().min(0),
  upserted: z.int().min(0),
  removed: z.int().min(0),
  /** Rows created after the backup that stayed because something still points at them. */
  kept: z.array(z.object({ table: z.string(), count: z.int().min(1) })),
});
export type RestoreResult = z.infer<typeof RestoreResult>;

export const adminBackupsApi = {
  /** Newest first, plus the schedule and when the next automatic run is due. */
  list: endpoint({
    method: 'GET',
    path: '/admin-api/backups',
    access: 'staff',
    perm: 'backups.manage',
    res: z.object({ items: z.array(BackupRow), config: BackupConfig, nextAutoAt: Timestamp.nullable() }),
  }),
  create: endpoint({
    method: 'POST',
    path: '/admin-api/backups',
    access: 'staff',
    perm: 'backups.manage',
    body: CreateBackupBody,
    res: z.object({ item: BackupRow }),
    rateLimit: 'RL_UPLOAD',
  }),
  config: endpoint({
    method: 'PUT',
    path: '/admin-api/backups/config',
    access: 'staff',
    perm: 'backups.manage',
    body: BackupConfig,
    res: z.object({ config: BackupConfig, nextAutoAt: Timestamp.nullable() }),
  }),
  /** The gzip JSON file (application/gzip, attachment). */
  download: endpoint({
    method: 'GET',
    path: '/admin-api/backups/:id/download',
    access: 'staff',
    perm: 'backups.manage',
    params: IdParams,
    res: 'binary',
  }),
  restore: endpoint({
    method: 'POST',
    path: '/admin-api/backups/:id/restore',
    access: 'staff',
    perm: 'backups.manage',
    params: IdParams,
    body: RestoreBackupBody,
    res: z.object({ result: RestoreResult }),
    rateLimit: 'RL_UPLOAD',
  }),
  remove: endpoint({
    method: 'DELETE',
    path: '/admin-api/backups/:id',
    access: 'staff',
    perm: 'backups.manage',
    params: IdParams,
    res: Ok,
  }),
} as const;
