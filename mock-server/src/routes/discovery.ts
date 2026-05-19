import { Router } from 'express';
import { handleOptionsRoute } from '../locationData';

const router = Router();

// SDK bootstrap: resourceareas — returning count:0/null forces SDK to use serverUrl for all APIs
router.get('/_apis/resourceareas', (_req, res) => {
    res.json({ count: 0, value: null });
});

router.get('/_apis/resourceareas/:areaId', (_req, res) => {
    res.json({ count: 0, value: null });
});

// SDK bootstrap: connectionData — must return authenticatedUser with a UUID or getCurrentUserId() fails
router.get('/_apis/connectionData', (_req, res) => {
    res.json({
        authenticatedUser: {
            id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
            providerDisplayName: 'Mock User',
            isActive: true,
            properties: {},
            resourceVersion: 1,
            metaTypeId: 6,
            subjectDescriptor: 'svc.bW9ja3VzZXI',
        },
        authorizedUser: {
            id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
            providerDisplayName: 'Mock User',
        },
        deploymentId: 'mock-deployment-001',
        deploymentType: 'hosted',
        instanceId: 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff',
        locationServiceData: {
            clientCacheTimeToLive: 60,
            currentServerMark: 0,
            serviceDefinitions: [],
        },
    });
});

// SDK bootstrap: OPTIONS /:org/_apis/:area — returns location templates so SDK builds correct URLs
router.options('/:org/_apis/:area', handleOptionsRoute);

export default router;
