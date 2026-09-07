import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../api/client';

export interface UserProfile {
  email: string;
  briefing_enabled: boolean;
  push_enabled: boolean;
  email_enabled: boolean;
  sync_status: 'healthy' | 'token_expired' | 'sync_error' | 'disconnected';
  briefing_time?: string;
}

export function useUserProfile() {
  return useQuery<UserProfile>({
    queryKey: ['userProfile'],
    queryFn: () => apiFetch('/users/me'),
  });
}

interface UpdateUserProfileVariables {
  briefing_enabled?: boolean;
  push_enabled?: boolean;
  email_enabled?: boolean;
  briefingTime?: string;
}

export function useUpdateUserProfile() {
  const queryClient = useQueryClient();

  return useMutation<UserProfile, Error, UpdateUserProfileVariables>({
    mutationFn: (variables) =>
      apiFetch('/users/me', {
        method: 'PATCH',
        body: JSON.stringify(variables),
      }),
    onSuccess: (updatedProfile) => {
      queryClient.setQueryData(['userProfile'], updatedProfile);
    },
  });
}
