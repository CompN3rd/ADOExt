export function classicReleaseUrl(
    organization: string,
    project: string,
    releaseId: number,
    options?: { environmentId?: number }
): string {
    const org = encodeURIComponent(organization);
    const proj = encodeURIComponent(project);
    const id = encodeURIComponent(String(releaseId));
    const base = `https://dev.azure.com/${org}/${proj}/_releaseProgress?_a=release-pipeline-progress&releaseId=${id}`;
    const environmentId = options?.environmentId;
    if (typeof environmentId === 'number' && environmentId > 0) {
        return `${base}&environmentId=${encodeURIComponent(String(environmentId))}`;
    }
    return base;
}

