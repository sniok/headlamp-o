// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { getLoginStatus } from './aks';

export interface AzureAuthStatus {
  isLoggedIn: boolean;
  isChecking: boolean;
  username?: string;
  tenantId?: string;
  error?: string;
}

/**
 * Hook to check Azure authentication status
 * @param redirectToLogin - If true, redirects to /azure/login when not authenticated
 * @returns Authentication status
 */
export function useAzureAuth(): AzureAuthStatus {
  const { data, isLoading } = useQuery({
    queryKey: ['auth-status'],
    queryFn: getLoginStatus,
  });

  return { ...data, isLoggedIn: data?.isLoggedIn ?? false, isChecking: isLoading };

  const [authStatus, setAuthStatus] = useState<AzureAuthStatus>({
    isLoggedIn: false,
    isChecking: true,
  });

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    try {
      const status = await getLoginStatus();

      const newAuthStatus = {
        isLoggedIn: status.isLoggedIn,
        isChecking: false,
        username: status.username,
        tenantId: status.tenantId,
        error: status.error,
      };

      setAuthStatus(newAuthStatus);
    } catch (e) {
      console.error(e);
    }
  };

  return authStatus;
}
