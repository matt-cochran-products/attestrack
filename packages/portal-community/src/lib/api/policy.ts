import { apiGet, apiPost, isLiveApi } from './http';
import { stubDelay } from './delay';
import { PORTAL_WORKER_PREFIX } from './constants';
import type { PolicyVersionLists } from './types';

async function stubListPolicyVersions(): Promise<PolicyVersionLists> {
  await stubDelay();
  return { privacyPolicy: [], termsOfUse: [] };
}

export async function listPolicyVersions(): Promise<PolicyVersionLists> {
  if (isLiveApi()) {
    return apiGet<PolicyVersionLists>('/api/portal/policy-versions');
  }
  return stubListPolicyVersions();
}

export async function publishPolicyVersion(data: Record<string, unknown>): Promise<{ success: boolean; hash: string }> {
  if (isLiveApi()) {
    return apiPost<{ success: boolean; hash: string }>(`${PORTAL_WORKER_PREFIX}/policy-versions`, data);
  }
  await stubDelay();
  const hash =
    'sha256:' +
    Math.random().toString(36).substring(2, 10) +
    '...' +
    Math.random().toString(36).substring(2, 6);
  return { success: true, hash };
}
