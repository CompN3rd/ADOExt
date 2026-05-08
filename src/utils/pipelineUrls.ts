export function pipelineRunUrl(
    organization: string,
    project: string,
    buildId: number,
    view: 'results' | 'logs' = 'results'
): string {
    const org = encodeURIComponent(organization);
    const proj = encodeURIComponent(project);
    const id = encodeURIComponent(String(buildId));
    const base = `https://dev.azure.com/${org}/${proj}/_build/results?buildId=${id}`;
    return view === 'logs' ? `${base}&view=logs` : `${base}&view=results`;
}

export function agentPoolUrl(organization: string, poolId?: number): string {
    const org = encodeURIComponent(organization);
    const base = `https://dev.azure.com/${org}/_settings/agentpools`;
    if (!poolId) {
        return base;
    }
    return `${base}?poolId=${encodeURIComponent(String(poolId))}`;
}

export function agentQueueUrl(organization: string, project: string, queueId?: number): string {
    const org = encodeURIComponent(organization);
    const proj = encodeURIComponent(project);
    const base = `https://dev.azure.com/${org}/${proj}/_settings/agentqueues`;
    if (!queueId) {
        return base;
    }
    return `${base}?queueId=${encodeURIComponent(String(queueId))}`;
}
