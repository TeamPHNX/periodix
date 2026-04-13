import { prisma } from '../../store/prisma.js';
import type { UserInsightSummary } from './types.js';

/**
 * Build a per-user insight summary including overall activity, today's stats,
 * feature usage distribution (last 30 days), session average (today), and recent activities.
 */
export async function getUserInsight(
    userId: string,
): Promise<UserInsightSummary | null> {
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, username: true, displayName: true },
    });
    if (!user) return null;

    // Fetch all activity timestamps for this user today for session calculation
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const activitiesToday = await prisma.userActivity.findMany({
        where: { userId, createdAt: { gte: startOfToday } },
        orderBy: { createdAt: 'asc' },
        select: { action: true, createdAt: true },
    });

    // Compute average session duration today (same heuristic: <=5m gap continues a session)
    let sessionCount = 0;
    let totalSessionMs = 0;
    if (activitiesToday.length > 0) {
        let sessionStart = activitiesToday[0]!.createdAt.getTime();
        let prev = activitiesToday[0]!;
        for (let i = 1; i < activitiesToday.length; i++) {
            const curr = activitiesToday[i]!;
            if (
                curr.createdAt.getTime() - prev.createdAt.getTime() >
                5 * 60 * 1000
            ) {
                // close session
                totalSessionMs += prev.createdAt.getTime() - sessionStart;
                sessionCount++;
                sessionStart = curr.createdAt.getTime();
            }
            prev = curr;
        }
        // close last session
        totalSessionMs += prev.createdAt.getTime() - sessionStart;
        sessionCount++;
    }

    const avgSessionMinutesToday = sessionCount
        ? Math.round(totalSessionMs / sessionCount / 60000)
        : undefined;

    // Total activities & first/last
    const extremes = await prisma.userActivity.findMany({
        where: { userId },
        select: { createdAt: true },
        orderBy: { createdAt: 'asc' },
        take: 1,
    });
    const latest = await prisma.userActivity.findMany({
        where: { userId },
        select: { createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 1,
    });

    const totalActivities = await prisma.userActivity.count({
        where: { userId },
    });

    // Feature usage last 30 days
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const featureAggregation = await prisma.userActivity.groupBy({
        by: ['action'],
        where: { userId, createdAt: { gte: since } },
        _count: { action: true },
    });
    const totalFeature =
        featureAggregation.reduce((s: any, r: any) => s + r._count.action, 0) ||
        1;
    const featureUsage = featureAggregation
        .map((r: any) => ({
            feature: r.action,
            count: r._count.action,
            percentage:
                Math.round((r._count.action / totalFeature) * 1000) / 10,
        }))
        .sort((a: any, b: any) => b.count - a.count)
        .slice(0, 25);

    // Recent activities (last 20)
    const recentRaw = await prisma.userActivity.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: { action: true, createdAt: true },
    });

    return {
        userId: user.id,
        username: user.username,
        displayName: user.displayName,
        totalActivities,
        firstActivityAt: extremes[0] ? extremes[0].createdAt : undefined,
        lastActivityAt: latest[0] ? latest[0].createdAt : undefined,
        todayActivityCount: activitiesToday.length,
        avgSessionMinutesToday,
        featureUsage,
        recentActivities: recentRaw,
    } as UserInsightSummary;
}
