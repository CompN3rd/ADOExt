import { Router } from 'express';
import { PROJECTS, TEAMS } from '../data/fixtures';

const router = Router();

// List projects
router.get('/:org/_apis/projects', (_req, res) => {
    res.json({ count: PROJECTS.length, value: PROJECTS });
});

router.get('/:org/_apis/projects/:projectId', (req, res) => {
    const project = PROJECTS.find(
        p => p.id === req.params.projectId || p.name === decodeURIComponent(req.params.projectId),
    );
    if (!project) {
        res.status(404).json({ message: 'Project not found' });
        return;
    }
    res.json(project);
});

// Teams
router.get('/:org/_apis/projects/:projectId/teams', (_req, res) => {
    res.json({ count: TEAMS.length, value: TEAMS });
});

router.get('/:org/_apis/projects/:projectId/teams/:teamId', (req, res) => {
    const team = TEAMS.find(t => t.id === req.params.teamId);
    if (!team) {
        res.status(404).json({ message: 'Team not found' });
        return;
    }
    res.json(team);
});

// Team members (return the three mock identities as members)
router.get('/:org/_apis/projects/:projectId/teams/:teamId/members', (_req, res) => {
    const members = [
        { identity: { id: 'uuuuuuuu-aaaa-aaaa-aaaa-aaaaaaaaaaaa', displayName: 'Alice Alvarez', uniqueName: 'alice@mockorg.onmicrosoft.com' } },
        { identity: { id: 'uuuuuuuu-bbbb-bbbb-bbbb-bbbbbbbbbbbb', displayName: 'Bob Baker', uniqueName: 'bob@mockorg.onmicrosoft.com' } },
        { identity: { id: 'uuuuuuuu-cccc-cccc-cccc-cccccccccccc', displayName: 'Carol Chen', uniqueName: 'carol@mockorg.onmicrosoft.com' } },
    ];
    res.json({ count: members.length, value: members });
});

export default router;
