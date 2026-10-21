// Zod 4 probes `new Function` to JIT-compile validators. That is blocked by our CSP / Trusted Types
// (no 'unsafe-eval'), so turn it off explicitly: validation never evaluates generated code.
import { z } from 'zod';

z.config({ jitless: true });
