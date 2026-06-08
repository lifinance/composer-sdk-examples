// COMPOSER_BASE_URL rather than BASE_URL to avoid collision with Vite's
// built-in process.env.BASE_URL (set to "/" from the `base` config option).
export const BASE_URL: string =
  process.env['COMPOSER_BASE_URL'] ?? 'https://composer.li.quest';
export const API_KEY: string | undefined = process.env['LIFI_API_KEY'];

// The staged (flashloan / lending / debt-migration) examples are a preview only
// available during the ETHGlobal hackathon, served by a separate backend. The
// runner targets this automatically for staged examples; set COMPOSER_BASE_URL
// to override it (or to point the production examples elsewhere).
export const STAGED_BASE_URL = 'https://ethglobal-composer.li.quest';

// True when the user pinned a backend explicitly, so the runner honors it
// verbatim instead of auto-selecting the staged preview backend.
export const HAS_EXPLICIT_BASE_URL: boolean =
  process.env['COMPOSER_BASE_URL'] != null;

export const OWNER = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';
export const RECIPIENT = '0x1234567890abcdef1234567890abcdef12345678';
export const PROXY = '0x2222222222222222222222222222222222222222';
