import { Router } from 'express';
import { WORK_ITEMS, WORK_ITEM_TYPES, CLASSIFICATION_NODES } from '../data/fixtures';

const router = Router();

// WIQL — return flat list of work item references; extension follows up with getWorkItems
router.post('/:org/:project/_apis/wit/wiql', (_req, res) => {
    const refs = WORK_ITEMS.map(wi => ({
        id: wi.id,
        url: wi.url,
    }));
    res.json({
        queryType: 'flat',
        queryResultType: 'workItem',
        asOf: new Date().toISOString(),
        columns: [
            { referenceName: 'System.Id', name: 'ID', url: '' },
            { referenceName: 'System.Title', name: 'Title', url: '' },
            { referenceName: 'System.State', name: 'State', url: '' },
            { referenceName: 'System.WorkItemType', name: 'Work Item Type', url: '' },
        ],
        workItems: refs,
    });
});

// Batch fetch by ?ids=
router.get('/:org/:project/_apis/wit/workItems', (req, res) => {
    const idsParam = req.query['ids'] as string | undefined;
    if (idsParam) {
        const ids = idsParam.split(',').map(Number).filter(Boolean);
        const items = WORK_ITEMS.filter(wi => ids.includes(wi.id));
        res.json({ count: items.length, value: items });
    } else {
        res.json({ count: WORK_ITEMS.length, value: WORK_ITEMS });
    }
});

// Single work item
router.get('/:org/:project/_apis/wit/workItems/:id', (req, res) => {
    const id = parseInt(req.params.id);
    const item = WORK_ITEMS.find(wi => wi.id === id);
    if (!item) {
        res.status(404).json({ message: 'Work item not found' });
        return;
    }
    res.json(item);
});

// Patch work item — echo back with updated fields
router.patch('/:org/:project/_apis/wit/workItems/:id', (req, res) => {
    const id = parseInt(req.params.id);
    const item = WORK_ITEMS.find(wi => wi.id === id);
    if (!item) {
        res.status(404).json({ message: 'Work item not found' });
        return;
    }
    // Apply JSON Patch operations from body
    const patches: { op: string; path: string; value: unknown }[] = req.body ?? [];
    const updatedItem = { ...item, fields: { ...item.fields } };
    for (const patch of patches) {
        if (patch.op === 'add' || patch.op === 'replace') {
            const fieldName = patch.path.replace('/fields/', '');
            updatedItem.fields = { ...updatedItem.fields, [fieldName]: patch.value };
        }
    }
    res.json(updatedItem);
});

// Work item types
router.get('/:org/:project/_apis/wit/workItemTypes', (_req, res) => {
    res.json({ count: WORK_ITEM_TYPES.length, value: WORK_ITEM_TYPES });
});

router.get('/:org/:project/_apis/wit/workItemTypes/:type', (req, res) => {
    const type = decodeURIComponent(req.params.type);
    const wit = WORK_ITEM_TYPES.find(t => t.name === type || t.referenceName === type);
    if (!wit) {
        res.status(404).json({ message: 'Work item type not found' });
        return;
    }
    res.json(wit);
});

// Classification nodes
router.get('/:org/:project/_apis/wit/classificationNodes/Areas', (_req, res) => {
    res.json(CLASSIFICATION_NODES.Areas);
});

router.get('/:org/:project/_apis/wit/classificationNodes/Iterations', (_req, res) => {
    res.json(CLASSIFICATION_NODES.Iterations);
});

router.get('/:org/:project/_apis/wit/classificationNodes/:structureGroup', (req, res) => {
    const group = req.params.structureGroup as keyof typeof CLASSIFICATION_NODES;
    const node = CLASSIFICATION_NODES[group];
    if (!node) {
        res.status(404).json({ message: 'Classification node not found' });
        return;
    }
    res.json(node);
});

// Fields (basic list)
router.get('/:org/:project/_apis/wit/fields', (_req, res) => {
    const fields = [
        { referenceName: 'System.Id', name: 'ID', type: 'integer' },
        { referenceName: 'System.Title', name: 'Title', type: 'string' },
        { referenceName: 'System.WorkItemType', name: 'Work Item Type', type: 'string' },
        { referenceName: 'System.State', name: 'State', type: 'string' },
        { referenceName: 'System.AssignedTo', name: 'Assigned To', type: 'identity' },
        { referenceName: 'System.AreaPath', name: 'Area Path', type: 'treePath' },
        { referenceName: 'System.IterationPath', name: 'Iteration Path', type: 'treePath' },
        { referenceName: 'Microsoft.VSTS.Common.Priority', name: 'Priority', type: 'integer' },
    ];
    res.json({ count: fields.length, value: fields });
});

export default router;
