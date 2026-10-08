// Must be the first import of the entry: zod v4 probes `new Function('')` when it builds object
// parsers. Under the strict CSP (no 'unsafe-eval') that probe fires a securitypolicyviolation on every
// page load; jitless skips it. Same as apps/app/web/src/zod-config.ts.
import { config } from 'zod';

config({ jitless: true });
