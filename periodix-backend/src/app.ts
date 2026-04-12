import express from 'express';
import cors, { type CorsOptions } from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import morgan from 'morgan';
import authRoutes from './routes/auth.js';
import timetableRoutes from './routes/timetable.js';
import adminRoutes from './routes/admin.js';
import userManagerRoutes from './routes/user-manager.js';
import usersRoutes from './routes/users.js';
import lessonColorsRoutes from './routes/lessonColors.js';
import sharingRoutes from './routes/sharing.js';
import accessRequestRoutes from './routes/accessRequest.js';
import notificationRoutes from './routes/notifications.js';
import analyticsRoutes from './routes/analytics.js';
import resourcesRoutes from './routes/resources.js';

dotenv.config();

const app = express();

const corsOriginEnv = process.env.CORS_ORIGIN;
// Basic security headers
app.use(
    helmet({
        crossOriginResourcePolicy: { policy: 'cross-origin' },
        contentSecurityPolicy: false, // can be enabled/tuned later
    })
);
// If running behind a proxy (Docker, reverse proxy), enable to get correct client IPs
app.set('trust proxy', 1);

// CORS config
// If CORS_ORIGIN is provided (comma/space-separated), restrict to those origins (normalized / pattern-matched).
// Supported entry formats:
//   * "*"                            -> reflect all origins (Access-Control-Allow-Origin: request origin)
//   * "https://example.com"          -> exact match (scheme + host + optional port)
//   * "example.com"                  -> host-only (both http/https, default ports 80/443 ignored)
//   * "*.example.com"                -> wildcard subdomains (both http/https)
//   * Multiple separated by comma / space
// Quotes & single trailing slashes are stripped. Case-insensitive.
// Optional: set CORS_DEBUG=true to log matching decisions.
function normalizeOrigin(input: string): string {
    return input
        .trim()
        .replace(/^['"]|['"]$/g, '') // strip wrapping quotes
        .replace(/\/$/, '') // drop single trailing slash
        .toLowerCase();
}

interface OriginRule {
    raw: string; // original normalized pattern string
    test: (origin: string, parsed: URL) => boolean;
}

function buildOriginRules(list: string[]): OriginRule[] {
    const rules: OriginRule[] = [];
    for (const raw of list) {
        if (!raw) continue;
        if (raw === '*') {
            // Will be handled earlier (reflect all) but keep for completeness
            rules.push({ raw: '*', test: () => true });
            continue;
        }
        // If includes scheme treat as full origin exact (ignoring trailing slash already removed)
        if (/^https?:\/\//.test(raw)) {
            const exact = raw;
            rules.push({
                raw,
                test: (_origin, parsed) =>
                    `${parsed.protocol}//${parsed.host}`.toLowerCase() ===
                    exact,
            });
            continue;
        }
        // Host-only or wildcard host (both http/https). Allow default port equivalence.
        const isWildcard = raw.startsWith('*.');
        const hostPattern = isWildcard ? raw.slice(2) : raw; // strip *.
        rules.push({
            raw,
            test: (_origin, parsed) => {
                const host = parsed.hostname.toLowerCase();
                if (isWildcard) {
                    return (
                        host === hostPattern || host.endsWith('.' + hostPattern)
                    );
                }
                return host === hostPattern;
            },
        });
    }
    return rules;
}

const debugCors = process.env.CORS_DEBUG === 'true';
let corsOptions: CorsOptions;
if (
    !corsOriginEnv ||
    corsOriginEnv === '*' ||
    corsOriginEnv.split(/[\s,]+/).some((v) => v === '*')
) {
    corsOptions = { credentials: true, origin: true };
} else {
    const allowedList = corsOriginEnv
        .split(/[\s,]+/)
        .map(normalizeOrigin)
        .filter(Boolean);
    const rules = buildOriginRules(allowedList);
    corsOptions = {
        credentials: true,
        origin: (origin, callback) => {
            if (!origin) return callback(null, true); // non-browser tools / same-origin server-side
            try {
                const parsed = new URL(origin);
                const matched = rules.some((r) => r.test(origin, parsed));
                if (debugCors) {
                    // eslint-disable-next-line no-console
                    console.log('[CORS]', {
                        origin,
                        matched,
                        patterns: allowedList,
                    });
                }
                if (matched) return callback(null, true);
            } catch (_e) {
                // Parsing failed: reject (invalid origin format)
            }
            return callback(new Error(`CORS: Origin ${origin} not allowed`));
        },
    };
}
app.use(cors(corsOptions));
app.use(express.json());
app.use(morgan('dev'));

app.get('/health', (_req, res) => {
    res.json({ ok: true, service: 'periodix-backend', time: new Date() });
});

app.use('/api/auth', authRoutes);
app.use('/api/timetable', timetableRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/user-manager', userManagerRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/lesson-colors', lessonColorsRoutes);
app.use('/api/sharing', sharingRoutes);
app.use('/api/access-request', accessRequestRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/resources', resourcesRoutes);

export default app;
