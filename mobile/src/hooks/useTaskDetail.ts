import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../api/client';
import { Task } from './useTodayTasks';

export function useTaskDetail(taskId: string) {
  return useQuery<Task>({
    queryKey: ['tasks', taskId],
    queryFn: () => apiFetch(`/tasks/${taskId}`),
    enabled: !!taskId,
  });
}

interface UpdateTaskVariables {
  title?: string;
  deadline_at?: string | null;
  status?: 'pending' | 'completed';
}

export function useUpdateTask(taskId: string) {
  const queryClient = useQueryClient();
  
  return useMutation<Task, Error, UpdateTaskVariables>({
    mutationFn: (variables) =>
      apiFetch(`/tasks/${taskId}`, {
        method: 'PATCH',
        body: JSON.stringify(variables),
      }),
    onSuccess: (updatedTask) => {
      // Invalidate today feed to show status/date updates immediately
      queryClient.invalidateQueries({ queryKey: ['tasks', 'today'] });
      // Update individual task detail cache
      queryClient.setQueryData(['tasks', taskId], updatedTask);
    },
  });
}

export function useDeleteTask(taskId: string) {
  const queryClient = useQueryClient();

  return useMutation<void, Error, void>({
    mutationFn: () =>
      apiFetch(`/tasks/${taskId}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      // Invalidate today feed to immediately reflect deletion
      queryClient.invalidateQueries({ queryKey: ['tasks', 'today'] });
      // Remove task detail from cache
      queryClient.removeQueries({ queryKey: ['tasks', taskId] });
    },
  });
}
