import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../api/client';

export interface Template {
  id: string;
  title: string;
  recurrence_type: 'daily' | 'weekly' | 'monthly' | 'custom_interval';
  interval_days?: number | null;
  days_of_week?: number[] | null;
  day_of_month?: number | null;
  time_of_day: string;
  timezone_snapshot: string;
  is_active: boolean;
}

interface CreateTemplateVariables {
  title: string;
  recurrence_type: 'daily' | 'weekly' | 'monthly' | 'custom_interval';
  interval_days?: number | null;
  days_of_week?: number[] | null;
  day_of_month?: number | null;
  time_of_day: string;
  timezone_snapshot: string;
}

export function useCreateTemplate() {
  const queryClient = useQueryClient();

  return useMutation<Template, Error, CreateTemplateVariables>({
    mutationFn: (variables) =>
      apiFetch('/templates', {
        method: 'POST',
        body: JSON.stringify(variables),
      }),
    onSuccess: () => {
      // Invalidate templates list query cache
      queryClient.invalidateQueries({ queryKey: ['templates'] });
    },
  });
}
