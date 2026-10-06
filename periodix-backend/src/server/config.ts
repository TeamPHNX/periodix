import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url); // eslint-disable-line @typescript-eslint/no-unused-vars
const __dirname = path.dirname(__filename); // eslint-disable-line @typescript-eslint/no-unused-vars

/**
 * Helper to read a required environment variable at runtime and provide a
 * concrete `string` type to TypeScript (avoids `string | undefined` issues).
 * We fail fast here so misconfiguration is immediately visible instead of
 * producing harder-to-debug downstream errors when contacting WebUntis.
 */
function requireEnv(name: string): string {
    const v = process.env[name];
    if (!v) {
        throw new Error(`Missing required environment variable: ${name}`);
    }
    return v;
}

// These are required for WebUntis interactions
export const UNTIS_DEFAULT_SCHOOL: string = requireEnv('UNTIS_DEFAULT_SCHOOL');
export const UNTIS_HOST: string = requireEnv('UNTIS_HOST');
export const JWT_SECRET: string = requireEnv('JWT_SECRET');

// Admin credentials are optional; default to empty strings
export const ADMIN_USERNAME: string = process.env.PERIODIX_ADMIN_USERNAME || '';
export const ADMIN_PASSWORD: string = process.env.PERIODIX_ADMIN_PASSWORD || '';

// Whitelist configuration for closed beta (DB-backed)
export const WHITELIST_ENABLED: boolean =
    process.env.WHITELIST_ENABLED === 'true';

// Timezone for lesson notifications (defaults to Europe/Berlin for German schools)
export const NOTIFICATION_TIMEZONE: string =
    process.env.NOTIFICATION_TIMEZONE || 'Europe/Berlin';
