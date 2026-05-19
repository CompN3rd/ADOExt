import { Router } from 'express';

const router = Router();

const AGENT_QUEUES = [
    { id: 1, name: 'Azure Pipelines', pool: { id: 1, name: 'Azure Pipelines', isHosted: true } },
    { id: 2, name: 'Default', pool: { id: 2, name: 'Default', isHosted: false } },
];

router.get('/:org/_apis/distributedtask/queues', (_req, res) => {
    res.json({ count: AGENT_QUEUES.length, value: AGENT_QUEUES });
});

router.get('/:org/_apis/distributedtask/queues/:queueId', (req, res) => {
    const queueId = parseInt(req.params.queueId);
    const queue = AGENT_QUEUES.find(q => q.id === queueId);
    if (!queue) {
        res.status(404).json({ message: 'Queue not found' });
        return;
    }
    res.json(queue);
});

export default router;
