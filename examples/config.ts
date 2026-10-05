// COMPOSER_BASE_URL rather than BASE_URL to avoid collision with Vite's
// built-in process.env.BASE_URL (set to "/" from the `base` config option).
export const BASE_URL: string =
  process.env['COMPOSER_BASE_URL'] ?? 'https://composer.li.quest';
// `apiKey` is required by `createComposeSdk`/`createComposeClient`; fall back to a
// placeholder so the examples remain runnable (against a backend that accepts it)
// without every contributor needing a real LI.FI API key set locally.
export const API_KEY: string = process.env['LIFI_API_KEY'] ?? 'YOUR_API_KEY';

export const OWNER = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';
export const RECIPIENT = '0x1234567890abcdef1234567890abcdef12345678';
export const PROXY = '0x0921afa7ab4895814f6130fd85aea549c345a109';
