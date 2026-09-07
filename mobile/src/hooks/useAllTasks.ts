import { useInfiniteQuery } from '@tanstack/react-query';
import { apiFetch } from '../api/client';
import { Task } from './useTodayTasks';

export interface TasksPaginatedResponse {
  tasks: Task[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    hasMore: boolean;
  };
}

export interface UseAllTasksParams {
  search?: string;
  status?: 'pending' | 'completed' | 'overdue' | 'all';
}

/**
 * useAllTasks hook fetches all tasks using infinite query pagination (tanstack query v5).
 * We chose useInfiniteQuery directly in this step to simplify the transition to infinite scrolling in Step 12.4.
 */
export function useAllTasks({ search = '', status = 'all' }: UseAllTasksParams) {
  const statusParam = status === 'all' ? '' : status;

  return useInfiniteQuery<TasksPaginatedResponse>({
    queryKey: ['tasks', 'all', { search, status }],
    queryFn: ({ pageParam = 1 }) => {
      const queryParams: string[] = [];
      queryParams.push(`page=${pageParam}`);
      queryParams.push(`limit=20`);
      
      if (search.trim() !== '') {
        queryParams.push(`search=${encodeURIComponent(search.trim())}`);
      }
      
      if (statusParam !== '') {
        queryParams.push(`status=${statusParam}`);
      }
      
      const queryString = queryParams.join('&');
      return apiFetch(`/tasks?${queryString}`);
    },
    initialPageParam: 1,
    getNextPageParam: (lastPage) => {
      if (lastPage.pagination && lastPage.pagination.hasMore) {
        return lastPage.pagination.page + 1;
      }
      return undefined;
    },
  });
}
