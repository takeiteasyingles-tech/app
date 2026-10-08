// Bindings of the workerd test project (vitest.config.ts).
import type { D1Migration } from 'cloudflare:test';

declare global {
  namespace Cloudflare {
    interface Env {
      DB: D1Database;
      MEDIA: R2Bucket;
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}
