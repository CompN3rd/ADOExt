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