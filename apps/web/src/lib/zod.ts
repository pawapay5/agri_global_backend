import { z } from "zod";

/**
 * Import `z` from here, not from "zod".
 * Zod 4 probes `new Function("")` to decide whether it can compile fast validators. Our CSP forbids eval, so the
 * probe is always blocked: Zod falls back correctly, but each probe files a CSP violation report. `jitless`
 * skips the probe (and the JIT it would enable, which CSP blocks anyway). It must run before any schema is
 * created, which an import of this module guarantees.
 */
z.config({ jitless: true });

export { z };
