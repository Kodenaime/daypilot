import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../api/client';

export interface Task {
  id: string;
  title: string;
  status: 'pending' | 'completed';
  deadline_at?: string;
  completed_at?: string;
  timezone_snapshot?: string;
  google_event_id?: string;
}

export function useTodayTasks() {
  return useQuery<Task[]>({
    queryKey: ['tasks', 'today'],
    queryFn: async () => {
      const tasks = await apiFetch('/tasks');
      
      const now = new Date();
      // Calculate local start of day and end of day bounds
      const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
      const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

      return tasks.filter((task: Task) => {
        if (!task.deadline_at) {
          // If no deadline, show if pending OR completed today (since local midnight)
          if (task.status === 'completed') {
            const compDate = task.completed_at ? new Date(task.completed_at) : null;
            return compDate && compDate >= startOfToday && compDate <= endOfToday;
          }
          return true;
        }

        const deadline = new Date(task.deadline_at);
        // Show if the deadline falls on today's calendar day in local time
        return deadline >= startOfToday && deadline <= endOfToday;
      });
    },
    refetchInterval: 60 * 1000, // Refresh automatically every 60 seconds when focused
  });
}
