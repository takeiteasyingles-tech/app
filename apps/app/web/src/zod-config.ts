// Must be the first import of the entry: zod v4 decides at schema construction whether to JIT
// object parsers, probing with `new Function('')`. Under the strict CSP (no 'unsafe-eval') that probe
// is caught but still fires a securitypolicyviolation on every page load. jitless skips the probe.
import { config } from 'zod';

config({ jitless: true });
