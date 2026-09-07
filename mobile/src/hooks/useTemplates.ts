import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../api/client';
import { Template } from './useCreateTemplate';

export function useTemplates() {
  return useQuery<Template[]>({
    queryKey: ['templates'],
    queryFn: () => apiFetch('/templates'),
  });
}

export function useTemplateDetail(templateId: string) {
  return useQuery<Template>({
    queryKey: ['templates', templateId],
    queryFn: () => apiFetch(`/templates/${templateId}`),
    enabled: !!templateId,
  });
}

interface UpdateTemplateVariables {
  title?: string;
  time_of_day?: string;
  interval_days?: number | null;
  days_of_week?: number[] | null;
  day_of_month?: number | null;
}

export function useUpdateTemplate(templateId: string) {
  const queryClient = useQueryClient();

  return useMutation<Template, Error, UpdateTemplateVariables>({
    mutationFn: (variables) =>
      apiFetch(`/templates/${templateId}`, {
        method: 'PATCH',
        body: JSON.stringify(variables),
      }),
    onSuccess: (updatedTemplate) => {
      queryClient.invalidateQueries({ queryKey: ['templates'] });
      queryClient.setQueryData(['templates', templateId], updatedTemplate);
    },
  });
}

export function useDeactivateTemplate(templateId: string) {
  const queryClient = useQueryClient();

  return useMutation<Template, Error, void>({
    mutationFn: () =>
      apiFetch(`/templates/${templateId}/deactivate`, {
        method: 'PATCH',
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['templates'] });
      queryClient.invalidateQueries({ queryKey: ['templates', templateId] });
    },
  });
}
