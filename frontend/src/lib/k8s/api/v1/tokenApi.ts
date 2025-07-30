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

import { decodeToken } from 'react-jwt';
import { isDebugVerbose } from '../../../../helpers/debugVerbose';
import { getCluster } from '../../../cluster';
import {
  BASE_HTTP_URL,
  CLUSTERS_PREFIX,
  JSON_HEADERS,
  MIN_LIFESPAN_FOR_TOKEN_REFRESH,
} from './constants';
import { combinePath } from './formatUrl';

let isTokenRefreshInProgress = false;

// TODO: Figure out how to refresh tokens
/**
 * Refreshes the token if it is about to expire.
 *
 * @param token - The token to refresh. For null token it just does nothing.
 *
 * @note Sets the token with `setToken` if the token is refreshed.
 * @note Uses global `isTokenRefreshInProgress` to prevent multiple token
 * refreshes at the same time.
 */
export async function refreshToken(token: string | null): Promise<void> {
  if (!token || isTokenRefreshInProgress) {
    return;
  }
  // decode token
  const decodedToken: any = decodeToken(token);

  // return if the token doesn't have an expiry time
  if (!decodedToken?.exp) {
    return;
  }
  // convert expiry seconds to date object
  const expiry = decodedToken.exp;
  const now = new Date().valueOf();
  const expDate = new Date(0);
  expDate.setUTCSeconds(expiry);

  // calculate time to expiry in seconds
  const diff = (expDate.valueOf() - now) / 1000;
  // If the token is not about to expire return
  // comparing the time to expiry with the minimum lifespan for a token both in seconds
  if (diff > MIN_LIFESPAN_FOR_TOKEN_REFRESH) {
    return;
  }
  const namespace =
    (decodedToken && decodedToken['kubernetes.io'] && decodedToken['kubernetes.io']['namespace']) ||
    '';
  const serviceAccountName =
    (decodedToken &&
      decodedToken['kubernetes.io'] &&
      decodedToken['kubernetes.io']['serviceaccount'] &&
      decodedToken['kubernetes.io']['serviceaccount']['name']) ||
    {};
  const cluster = getCluster();
  if (!cluster || namespace === '' || serviceAccountName === '') {
    return;
  }

  if (isDebugVerbose('k8s/apiProxy@refreshToken')) {
    console.debug('k8s/apiProxy@refreshToken', 'Refreshing token');
  }

  isTokenRefreshInProgress = true;

  let tokenUrl = combinePath(BASE_HTTP_URL, `/${CLUSTERS_PREFIX}/${cluster}`);
  tokenUrl = combinePath(
    tokenUrl,
    `api/v1/namespaces/${namespace}/serviceaccounts/${serviceAccountName}/token`
  );
  const tokenData = {
    kind: 'TokenRequest',
    apiVersion: 'authentication.k8s.io/v1',
    metadata: { creationTimestamp: null },
    spec: { expirationSeconds: 86400 },
  };

  try {
    const headers = new Headers({
      ...JSON_HEADERS,
    });

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(tokenData),
    });

    if (response.status === 201) {
      // const token: KubeToken = await response.json();
      // setToken(cluster, token.status.token);
    }

    isTokenRefreshInProgress = false;
  } catch (err) {
    console.error('Error refreshing token', err);
    isTokenRefreshInProgress = false;
  }
}
