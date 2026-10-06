// Throttles repeated failed logins (password guessing) per username and per IP.
// In-memory like the other limiters; good enough for a single backend process.

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES_PER_USERNAME = 10;
const MAX_FAILURES_PER_IP = 30;

type Entry = { failures: number[] };
const failuresByKey = new Map<string, Entry>();

function recent(key: string, now: number): number[] {
    const entry = failuresByKey.get(key);
    if (!entry) return [];
    entry.failures = entry.failures.filter((t) => now - t < WINDOW_MS);
    if (!entry.failures.length) failuresByKey.delete(key);
    return entry.failures;
}

const userKey = (username: string) => `user:${username.trim().toLowerCase()}`;
const ipKey = (ip: string | undefined) => `ip:${ip ?? 'unknown'}`;

/** Seconds until another attempt is allowed, or 0 when not throttled. */
export function loginRetryAfterSeconds(username: string, ip: string | undefined): number {
    const now = Date.now();
    const checks: Array<[string, number]> = [
        [userKey(username), MAX_FAILURES_PER_USERNAME],
        [ipKey(ip), MAX_FAILURES_PER_IP],
    ];
    let wait = 0;
    for (const [key, max] of checks) {
        const failures = recent(key, now);
        if (failures.length >= max) {
            const oldest = failures[failures.length - max]!;
            wait = Math.max(wait, Math.ceil((oldest + WINDOW_MS - now) / 1000));
        }
    }
    return wait;
}

export function recordLoginFailure(username: string, ip: string | undefined) {
    const now = Date.now();
    for (const key of [userKey(username), ipKey(ip)]) {
        const entry = failuresByKey.get(key) ?? { failures: [] };
        entry.failures.push(now);
        failuresByKey.set(key, entry);
    }
}

export function clearLoginFailures(username: string) {
    failuresByKey.delete(userKey(username));
}
