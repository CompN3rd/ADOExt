import { Router } from 'express';
import { BUILDS, BUILD_TIMELINES } from '../data/fixtures';

const router = Router();

// List builds
router.get('/:org/:project/_apis/build/builds', (req, res) => {
    let builds = [...BUILDS];

    const definitionId = req.query['definitions'] as string | undefined;
    if (definitionId) {
        const ids = definitionId.split(',').map(Number);
        builds = builds.filter(b => ids.includes(b.definition.id));
    }

    const statusFilter = req.query['statusFilter'] as string | undefined;
    if (statusFilter) {
        builds = builds.filter(b => b.status === statusFilter);
    }

    const resultFilter = req.query['resultFilter'] as string | undefined;
    if (resultFilter) {
        builds = builds.filter(b => b.result === resultFilter);
    }

    const branchName = req.query['branchName'] as string | undefined;
    if (branchName) {
        builds = builds.filter(b => b.sourceBranch === branchName);
    }

    const top = req.query['$top'] ? parseInt(req.query['$top'] as string) : undefined;
    if (top) {
        builds = builds.slice(0, top);
    }

    res.json({ count: builds.length, value: builds });
});

// Single build
router.get('/:org/:project/_apis/build/builds/:buildId', (req, res) => {
    const buildId = parseInt(req.params.buildId);
    const build = BUILDS.find(b => b.id === buildId);
    if (!build) {
        res.status(404).json({ message: 'Build not found' });
        return;
    }
    res.json(build);
});

// Build timeline
router.get('/:org/:project/_apis/build/builds/:buildId/timeline', (req, res) => {
    const buildId = parseInt(req.params.buildId);
    const timeline = BUILD_TIMELINES[buildId as keyof typeof BUILD_TIMELINES];
    if (!timeline) {
        res.status(404).json({ message: 'Timeline not found' });
        return;
    }
    res.json(timeline);
});

router.get('/:org/:project/_apis/build/builds/:buildId/timeline/:timelineId', (req, res) => {
    const buildId = parseInt(req.params.buildId);
    const timeline = BUILD_TIMELINES[buildId as keyof typeof BUILD_TIMELINES];
    if (!timeline) {
        res.status(404).json({ message: 'Timeline not found' });
        return;
    }
    res.json(timeline);
});

// Build definitions
router.get('/:org/:project/_apis/build/definitions', (_req, res) => {
    const definitions = [
        { id: 1, name: 'CI Pipeline', type: 'build', quality: 'definition', queueStatus: 'enabled' },
        { id: 2, name: 'Nightly Build', type: 'build', quality: 'definition', queueStatus: 'enabled' },
    ];
    res.json({ count: definitions.length, value: definitions });
});

router.get('/:org/:project/_apis/build/definitions/:definitionId', (req, res) => {
    const id = parseInt(req.params.definitionId);
    const defs = [
        { id: 1, name: 'CI Pipeline', type: 'build', quality: 'definition', queueStatus: 'enabled' },
        { id: 2, name: 'Nightly Build', type: 'build', quality: 'definition', queueStatus: 'enabled' },
    ];
    const def = defs.find(d => d.id === id);
    if (!def) {
        res.status(404).json({ message: 'Definition not found' });
        return;
    }
    res.json(def);
});

export default router;
