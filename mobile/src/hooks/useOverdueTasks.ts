import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../api/client';
import { Task } from './useTodayTasks';

export function useOverdueTasks() {
  return useQuery<Task[]>({
    queryKey: ['tasks', 'overdue'],
    queryFn: () => apiFetch('/tasks/overdue'),
    refetchInterval: 60 * 1000, // Refresh automatically every 60 seconds when focused
  });
}
