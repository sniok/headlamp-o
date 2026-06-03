/*
 * Copyright 2025 The Kubernetes Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { registerAddClusterProvider, registerRoute } from '@kinvolk/headlamp-plugin/lib';
import { queryClient } from '@kinvolk/headlamp-plugin/lib/queryClient';
import { getStatelessClusterKubeConfigs } from '@kinvolk/headlamp-plugin/lib/stateless';
import { auth } from '@kinvolk/headlamp-plugin/lib/Utils';
import { QueryClientProvider } from '@tanstack/react-query';
import { getAksToken, getLoginStatus } from './aks';
import RegisterAKSClusterDialog from './RegisterAKSCluster';

registerRoute({
  path: '/add-cluster-aks',
  component: () => {
    return (
      <QueryClientProvider client={queryClient}>
        <RegisterAKSClusterDialog />
      </QueryClientProvider>
    );
  },
  name: 'Register AKS Cluster',
  sidebar: null,
  exact: true,
  useClusterURL: false,
  noAuthRequired: true,
});

registerAddClusterProvider({
  title: 'Azure Kubernetes Service',
  // @ts-ignore todo fix registerAddClusterProvider icon to take string
  icon: 'logos:microsoft-azure',
  description:
    'Connect to an existing AKS (Azure Kubernetes Service) cluster from your Azure subscription. Requires Azure CLI authentication.',
  url: '/add-cluster-aks',
});

// Update AKS cluster tokens on app launch
async function refreshClusterTokens() {
  try {
    const login = await getLoginStatus();
    if (!login.isLoggedIn) return;

    console.log('logged in', login);

    const kubeconfigs = await getStatelessClusterKubeConfigs();
    console.log({ kubeconfigs });
    if (!kubeconfigs || kubeconfigs.length === 0) return;

    const tokenResult = await getAksToken();
    console.log({ tokenResult });
    if (!tokenResult.token) return;

    for (const kubeconfigBase64 of kubeconfigs) {
      try {
        const kubeconfigYaml = atob(kubeconfigBase64);
        const kubeconfig = JSON.parse(
          JSON.stringify(await import('js-yaml').then(yaml => yaml.load(kubeconfigYaml)))
        );

        const aksInfo = kubeconfig.extensions?.find(
          (ext: any) => ext.name === 'aks_info'
        )?.extension;

        console.log({ aksInfo, kubeconfig });

        if (!aksInfo) continue;

        // Update token in users
        for (const user of kubeconfig.users || []) {
          if (user.user) {
            user.user.token = 'TOKEN';
          }
        }

        // Get cluster name from context
        const clusterName = kubeconfig.contexts?.[0]?.name;
        if (!clusterName) continue;

        auth.setToken(clusterName, tokenResult.token);
      } catch (err) {
        console.error('[AKS] Error updating cluster token:', err);
      }
    }
  } catch (err) {
    console.error('[AKS] Error refreshing AKS cluster tokens:', err);
  }
}
refreshClusterTokens();
setInterval(refreshClusterTokens, 30 * 60 * 1000);
