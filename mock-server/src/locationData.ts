import { Request, Response } from 'express';

interface LocationEntry {
    id: string;
    area: string;
    resourceName: string;
    routeTemplate: string;
    resourceVersion: number;
    minVersion: string;
    maxVersion: string;
    releasedVersion: string;
}

interface LocationResponse {
    count: number;
    value: LocationEntry[];
}

// Maps area name (lowercased) to location entries matching standard ADO SDK expectations.
const LOCATION_DATA: Record<string, LocationResponse> = {
    build: {
        count: 3,
        value: [
            {
                id: '1db06c96-a5b8-4d49-9a2b-1c7cf6b1d2be',
                area: 'build',
                resourceName: 'builds',
                routeTemplate: '{project}/_apis/{area}/{resource}/{buildId}',
                resourceVersion: 7,
                minVersion: '2.0',
                maxVersion: '7.1',
                releasedVersion: '7.0',
            },
            {
                id: 'f2192269-8f6f-4a05-a20d-5ccdf1c62caa',
                area: 'build',
                resourceName: 'timeline',
                routeTemplate: '{project}/_apis/{area}/{resource}/{buildId}/timeline/{timelineId}',
                resourceVersion: 2,
                minVersion: '2.0',
                maxVersion: '7.1',
                releasedVersion: '7.0',
            },
            {
                id: '10a7b7da-d6b0-41af-be77-b01b7ac1e1f5',
                area: 'build',
                resourceName: 'definitions',
                routeTemplate: '{project}/_apis/{area}/{resource}/{definitionId}',
                resourceVersion: 7,
                minVersion: '2.0',
                maxVersion: '7.1',
                releasedVersion: '7.0',
            },
        ],
    },
    git: {
        count: 4,
        value: [
            {
                id: 'a5d28130-9902-4f64-9b1e-3e19a8d8b6f1',
                area: 'git',
                resourceName: 'pullRequests',
                routeTemplate: '{project}/_apis/{area}/repositories/{repositoryId}/{resource}/{pullRequestId}',
                resourceVersion: 1,
                minVersion: '3.0',
                maxVersion: '7.1',
                releasedVersion: '7.0',
            },
            {
                id: 'b43dd56f-9b9c-4f2a-80a6-2d45d7b9e3c8',
                area: 'git',
                resourceName: 'pullRequestsByProject',
                routeTemplate: '{project}/_apis/{area}/{resource}',
                resourceVersion: 1,
                minVersion: '3.0',
                maxVersion: '7.1',
                releasedVersion: '7.0',
            },
            {
                id: 'd528a4e3-8a83-4ba2-8b7f-db21ffe63a84',
                area: 'git',
                resourceName: 'repositories',
                routeTemplate: '{project}/_apis/{area}/{resource}/{repositoryId}',
                resourceVersion: 1,
                minVersion: '3.0',
                maxVersion: '7.1',
                releasedVersion: '7.0',
            },
            {
                id: '7b28e929-2c99-405d-9c5c-6167a06bedd9',
                area: 'git',
                resourceName: 'threads',
                routeTemplate: '{project}/_apis/{area}/repositories/{repositoryId}/pullRequests/{pullRequestId}/{resource}/{threadId}',
                resourceVersion: 1,
                minVersion: '3.0',
                maxVersion: '7.1',
                releasedVersion: '7.0',
            },
        ],
    },
    wit: {
        count: 5,
        value: [
            {
                id: '72c7ddf8-763c-4a75-a574-66a2a5aa5186',
                area: 'wit',
                resourceName: 'workItems',
                routeTemplate: '{project}/_apis/{area}/{resource}/{id}',
                resourceVersion: 3,
                minVersion: '1.0',
                maxVersion: '7.1',
                releasedVersion: '7.0',
            },
            {
                id: '1a9c53f7-475e-4b49-84c6-6c0c14b15a7e',
                area: 'wit',
                resourceName: 'wiql',
                routeTemplate: '{project}/_apis/{area}/{resource}/{id}',
                resourceVersion: 2,
                minVersion: '1.0',
                maxVersion: '7.1',
                releasedVersion: '7.0',
            },
            {
                id: 'f5b5ef76-6e3e-462c-a2c1-a34e2d3c74b5',
                area: 'wit',
                resourceName: 'workItemTypes',
                routeTemplate: '{project}/_apis/{area}/{resource}/{type}',
                resourceVersion: 2,
                minVersion: '1.0',
                maxVersion: '7.1',
                releasedVersion: '7.0',
            },
            {
                id: '448524e7-9e2e-42b8-bac8-3e1e4f9fe862',
                area: 'wit',
                resourceName: 'classificationNodes',
                routeTemplate: '{project}/_apis/{area}/{resource}/{structureGroup}/{*path}',
                resourceVersion: 2,
                minVersion: '1.0',
                maxVersion: '7.1',
                releasedVersion: '7.0',
            },
            {
                id: 'b7a26d56-8944-4b98-b3f3-9b7e71236e5a',
                area: 'wit',
                resourceName: 'fields',
                routeTemplate: '{project}/_apis/{area}/{resource}/{fieldNameOrRefName}',
                resourceVersion: 2,
                minVersion: '1.0',
                maxVersion: '7.1',
                releasedVersion: '7.0',
            },
        ],
    },
    core: {
        count: 2,
        value: [
            {
                id: '603fe2ac-9a1b-7d17-9571-1b6d0a27d7c1',
                area: 'core',
                resourceName: 'projects',
                routeTemplate: '_apis/{resource}/{projectId}',
                resourceVersion: 4,
                minVersion: '1.0',
                maxVersion: '7.1',
                releasedVersion: '7.0',
            },
            {
                id: 'd9ce4b43-c142-4e8a-b573-fa25e3d7b3b7',
                area: 'core',
                resourceName: 'teams',
                routeTemplate: '_apis/{resource}/{projectId}/teams/{teamId}',
                resourceVersion: 3,
                minVersion: '2.0',
                maxVersion: '7.1',
                releasedVersion: '7.0',
            },
        ],
    },
    policy: {
        count: 1,
        value: [
            {
                id: 'c23ddff5-229c-4a43-ab84-7b773f32a4c4',
                area: 'policy',
                resourceName: 'evaluations',
                routeTemplate: '{project}/_apis/{area}/{resource}/{evaluationId}',
                resourceVersion: 1,
                minVersion: '5.0',
                maxVersion: '7.1',
                releasedVersion: '7.0',
            },
        ],
    },
    test: {
        count: 2,
        value: [
            {
                id: 'cadb3810-d47d-4a3c-a234-fe6e6ecca16c',
                area: 'Test',
                resourceName: 'runs',
                routeTemplate: '{project}/_apis/{area}/{resource}/{runId}',
                resourceVersion: 3,
                minVersion: '1.0',
                maxVersion: '7.1',
                releasedVersion: '7.0',
            },
            {
                id: '4637d869-3a76-4468-8057-0bb02aa385cf',
                area: 'Test',
                resourceName: 'results',
                routeTemplate: '{project}/_apis/{area}/runs/{runId}/{resource}/{testCaseResultId}',
                resourceVersion: 6,
                minVersion: '1.0',
                maxVersion: '7.1',
                releasedVersion: '7.0',
            },
        ],
    },
    distributedtask: {
        count: 1,
        value: [
            {
                id: 'e3a4e9d0-4e63-47d6-b7a8-12a6b3e4d5f1',
                area: 'distributedtask',
                resourceName: 'queues',
                routeTemplate: '_apis/{area}/{resource}/{queueId}',
                resourceVersion: 1,
                minVersion: '3.0',
                maxVersion: '7.1',
                releasedVersion: '7.0',
            },
        ],
    },
    location: {
        count: 1,
        value: [
            {
                id: 'b5cb0e54-ef54-4a68-8e5e-bc0d18b07ced',
                area: 'Location',
                resourceName: 'resourceAreas',
                routeTemplate: '_apis/{resource}/{areaId}',
                resourceVersion: 1,
                minVersion: '5.0',
                maxVersion: '7.1',
                releasedVersion: '7.0',
            },
        ],
    },
    profile: {
        count: 1,
        value: [
            {
                id: '4701b6ec-ee58-4bef-8a54-c0fd5f8e5a46',
                area: 'Profile',
                resourceName: 'profiles',
                routeTemplate: '_apis/{resource}/{id}',
                resourceVersion: 3,
                minVersion: '1.0',
                maxVersion: '7.1',
                releasedVersion: '7.0',
            },
        ],
    },
};

export function handleOptionsRoute(req: Request, res: Response): void {
    const area = (req.params.area ?? '').toLowerCase();
    const data = LOCATION_DATA[area];
    if (data) {
        res.json(data);
    } else {
        // Return empty location response for unknown areas so SDK doesn't crash
        res.json({ count: 0, value: [] });
    }
}
