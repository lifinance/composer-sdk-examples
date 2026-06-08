// Side-effect module: load a local `.env` (if present) before any other
// module reads `process.env`. Imported first in `run.ts` so the values are
// in place by the time `config.ts` is evaluated.
//
// No-op when there is no `.env` file — the examples then read whatever is
// already in the ambient environment (e.g. vars passed inline on the CLI).
try {
  process.loadEnvFile();
} catch {
  // No `.env` file found; continue with the ambient environment.
}
