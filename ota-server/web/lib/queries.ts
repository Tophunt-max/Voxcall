import { useQuery } from '@tanstack/react-query';
import { api, type AppId } from './api';

// Real-time: every query polls every 8s, so the whole dashboard stays live.
const LIVE = { refetchInterval: 8000, refetchOnWindowFocus: true, staleTime: 4000 } as const;

export function useOtaState(app: AppId) {
  return useQuery({ queryKey: ['state', app], queryFn: () => api.state(app), ...LIVE });
}
export function useMetrics(app: AppId) {
  return useQuery({ queryKey: ['metrics', app], queryFn: () => api.metrics(app), ...LIVE });
}
export function useBuilds(app: AppId) {
  return useQuery({ queryKey: ['builds', app], queryFn: () => api.builds(app), ...LIVE });
}
