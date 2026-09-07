import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../api/client';
import { Task } from './useTodayTasks';

interface CreateTaskVariables {
  title: string;
  deadline_at: string | null;
  timezone_snapshot: string;
}

export function useCreateTask() {
  const queryClient = useQueryClient();

  return useMutation<Task, Error, CreateTaskVariables>({
    mutationFn: (variables) =>
      apiFetch('/tasks', {
        method: 'POST',
        body: JSON.stringify(variables),
      }),
    onSuccess: () => {
      // Invalidate today feed to show the new task immediately
      queryClient.invalidateQueries({ queryKey: ['tasks', 'today'] });
    },
  });
}
