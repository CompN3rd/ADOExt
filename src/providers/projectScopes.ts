import type { AdoClient } from '../api/adoClient';
import { ALL_PROJECTS, type ConfigManager } from '../config/configManager';
import { mapWithConcurrencyLimit } from '../utils/async';

export interface ProjectScope {
    organization: string;
    project: string;
}

export function scopeKey(scope: ProjectScope): string {
    return `${scope.organization}\u0000${scope.project}`;
}

export function scopeLabel(scope: ProjectScope): string {
    return `${scope.organization}/${scope.project}`;
}

export async function resolveProjectScopes(
    client: AdoClient,
    config: ConfigManager
): Promise<ProjectScope[]> {
    const scopes: ProjectScope[] = [];

    for (const organization of config.selectedOrganizations) {
        const projectSelection = config.getProjectSelection(organization);
        if (projectSelection.includes(ALL_PROJECTS)) {
            const projects = await client.listProjects(organization);
            for (const project of projects) {
                if (project.name) {
                    scopes.push({ organization, project: project.name });
                }
            }
            continue;
        }

        for (const project of projectSelection) {
            scopes.push({ organization, project });
        }
    }

    return scopes;
}
export async function forEachScope<T>(
    client: AdoClient,
    config: ConfigManager,
    fetcher: (scope: ProjectScope) => Promise<T[]>,
    concurrency = 4
): Promise<{ scopes: ProjectScope[]; items: T[] }> {
    const scopes = await resolveProjectScopes(client, config);
    if (scopes.length === 0) {
        return { scopes, items: [] };
    }
    const nested = await mapWithConcurrencyLimit(scopes, concurrency, fetcher);
    return { scopes, items: nested.flat() };
}
