
import { Router } from 'express';
import { authMiddleware } from '../server/authMiddleware.js';
import { getAggregatedResources } from '../services/resourceService.js';

const router = Router();

// Apply auth middleware to all routes
router.use(authMiddleware);

router.get('/overview', async (req, res) => {
    // Check if user is user manager
    const userFn = req.user as any; 
    // authMiddleware should have populated req.user.
    // However, authMiddleware only fetches { id, isUserManager } if not admin.
    // Let's rely on req.user which is populated in authMiddleware.
    
    // We need to verify if the user is a manager or admin
    if (!userFn?.isUserManager && !userFn?.isAdmin) {
        res.status(403).json({ error: 'Access denied: User Manager role required' });
        return;
    }

    try {
        const data = await getAggregatedResources(userFn.id);
        res.json(data);
    } catch (error) {
        console.error('Error fetching aggregated resources:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;
