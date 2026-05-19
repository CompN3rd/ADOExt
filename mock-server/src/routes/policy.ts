import { Router } from 'express';
import { POLICY_EVALUATIONS } from '../data/fixtures';

const router = Router();

// Policy evaluations — filtered by artifactId query param
router.get('/:org/:project/_apis/policy/evaluations', (req, res) => {
    const artifactId = req.query['artifactId'] as string | undefined;

    // Extract PR ID from artifact ID string like "vstfs:///CodeReview/CodeReviewId/projectId/prId"
    let evaluations: unknown[] = [];
    if (artifactId) {
        const match = artifactId.match(/\/(\d+)$/);
        if (match) {
            const prId = parseInt(match[1]);
            evaluations = POLICY_EVALUATIONS[prId as keyof typeof POLICY_EVALUATIONS] ?? [];
        }
    } else {
        // Return all evaluations flattened
        evaluations = Object.values(POLICY_EVALUATIONS).flat();
    }

    res.json({ count: evaluations.length, value: evaluations });
});

export default router;
