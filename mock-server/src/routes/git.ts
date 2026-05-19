import { Router } from 'express';
import { PULL_REQUESTS, PR_THREADS, PR_ITERATIONS, PR_STATUSES, REPO } from '../data/fixtures';

const router = Router();

// Repositories
router.get('/:org/:project/_apis/git/repositories', (_req, res) => {
    res.json({ count: 1, value: [REPO] });
});

router.get('/:org/:project/_apis/git/repositories/:repoId', (_req, res) => {
    res.json(REPO);
});

// Pull requests by project (no repoId)
router.get('/:org/:project/_apis/git/pullrequests', (req, res) => {
    let prs = [...PULL_REQUESTS];

    const status = req.query['searchCriteria.status'] as string | undefined;
    if (status && status !== 'all') {
        prs = prs.filter(pr => pr.status === status);
    }

    const creatorId = req.query['searchCriteria.creatorId'] as string | undefined;
    if (creatorId) {
        prs = prs.filter(pr => pr.createdBy.id === creatorId);
    }

    const reviewerId = req.query['searchCriteria.reviewerId'] as string | undefined;
    if (reviewerId) {
        prs = prs.filter(pr => pr.reviewers.some(r => r.id === reviewerId));
    }

    res.json({ count: prs.length, value: prs });
});

// Pull requests by repo
router.get('/:org/:project/_apis/git/repositories/:repoId/pullrequests', (req, res) => {
    let prs = [...PULL_REQUESTS];

    const status = req.query['searchCriteria.status'] as string | undefined;
    if (status && status !== 'all') {
        prs = prs.filter(pr => pr.status === status);
    }

    const creatorId = req.query['searchCriteria.creatorId'] as string | undefined;
    if (creatorId) {
        prs = prs.filter(pr => pr.createdBy.id === creatorId);
    }

    const reviewerId = req.query['searchCriteria.reviewerId'] as string | undefined;
    if (reviewerId) {
        prs = prs.filter(pr => pr.reviewers.some(r => r.id === reviewerId));
    }

    res.json({ count: prs.length, value: prs });
});

// Single PR
router.get('/:org/:project/_apis/git/repositories/:repoId/pullrequests/:prId', (req, res) => {
    const prId = parseInt(req.params.prId);
    const pr = PULL_REQUESTS.find(p => p.pullRequestId === prId);
    if (!pr) {
        res.status(404).json({ message: 'Pull request not found' });
        return;
    }
    res.json(pr);
});

// PR threads
router.get('/:org/:project/_apis/git/repositories/:repoId/pullrequests/:prId/threads', (req, res) => {
    const prId = parseInt(req.params.prId);
    const threads = PR_THREADS[prId as keyof typeof PR_THREADS] ?? [];
    res.json({ count: threads.length, value: threads });
});

// PR iterations
router.get('/:org/:project/_apis/git/repositories/:repoId/pullrequests/:prId/iterations', (req, res) => {
    const prId = parseInt(req.params.prId);
    const iterations = PR_ITERATIONS[prId as keyof typeof PR_ITERATIONS] ?? [];
    res.json({ count: iterations.length, value: iterations });
});

// PR statuses
router.get('/:org/:project/_apis/git/repositories/:repoId/pullrequests/:prId/statuses', (req, res) => {
    const prId = parseInt(req.params.prId);
    const statuses = PR_STATUSES[prId as keyof typeof PR_STATUSES] ?? [];
    res.json({ count: statuses.length, value: statuses });
});

export default router;
