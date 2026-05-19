import { Router } from 'express';
import { TEST_RUNS, TEST_RESULTS } from '../data/fixtures';

const router = Router();

// List test runs, optionally filtered by buildId
router.get('/:org/:project/_apis/test/runs', (req, res) => {
    const buildId = req.query['buildId'] ? parseInt(req.query['buildId'] as string) : undefined;

    let runs: unknown[] = [];
    if (buildId) {
        runs = TEST_RUNS[buildId as keyof typeof TEST_RUNS] ?? [];
    } else {
        runs = Object.values(TEST_RUNS).flat();
    }

    res.json({ count: runs.length, value: runs });
});

// Single test run
router.get('/:org/:project/_apis/test/runs/:runId', (req, res) => {
    const runId = parseInt(req.params.runId);
    const allRuns = Object.values(TEST_RUNS).flat() as { id: number }[];
    const run = allRuns.find(r => r.id === runId);
    if (!run) {
        res.status(404).json({ message: 'Test run not found' });
        return;
    }
    res.json(run);
});

// Test results for a run
router.get('/:org/:project/_apis/test/runs/:runId/results', (req, res) => {
    const runId = parseInt(req.params.runId);
    const results = TEST_RESULTS[runId as keyof typeof TEST_RESULTS] ?? [];
    res.json({ count: results.length, value: results });
});

export default router;
