import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../api/client';
import { Task } from './useTodayTasks';

export interface NextFocusTaskResponse {
  task: Task | null;
}

export function useNextFocusTask() {
  return useQuery<NextFocusTaskResponse>({
    queryKey: ['tasks', 'next-focus'],
    queryFn: () => apiFetch('/tasks/next'),
    refetchInterval: 30 * 1000, // Refresh automatically every 30 seconds when focused
  });
}
