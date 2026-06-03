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

import {
  AuthenticationRecord,
  deserializeAuthenticationRecord,
  InteractiveBrowserCredential,
  serializeAuthenticationRecord,
  useIdentityPlugin,
} from '@azure/identity';
import { cachePersistencePlugin } from '@azure/identity-cache-persistence';
import { app, ipcMain } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

useIdentityPlugin(cachePersistencePlugin);

const isWSL = () => {
  try {
    return fs.readFileSync('/proc/version', 'utf-8').toLowerCase().includes('microsoft');
  } catch {
    return false;
  }
};

const makePromiseQueue = () => {
  let queue: Promise<unknown> = Promise.resolve();

  function enqueuePromise<T>(fn: () => Promise<T>): Promise<T> {
    const result = queue.then(fn);
    queue = result.then(
      () => {},
      () => {}
    );
    return result;
  }

  return { enqueuePromise };
};

const AuthRecord = {
  PATH: path.join(app.getPath('userData'), 'azure_auth_record.json'),
  exists() {
    return fs.existsSync(AuthRecord.PATH);
  },
  load() {
    if (AuthRecord.exists()) {
      const content = fs.readFileSync(AuthRecord.PATH, 'utf-8');
      return deserializeAuthenticationRecord(content);
    }
  },
  save(record: AuthenticationRecord) {
    fs.writeFileSync(AuthRecord.PATH, serializeAuthenticationRecord(record), 'utf-8');
  },
  clear() {
    if (AuthRecord.exists()) {
      fs.unlinkSync(AuthRecord.PATH);
    }
  },
};

const AzureApi = {
  credential: undefined as InteractiveBrowserCredential | undefined,
  getCredential(): InteractiveBrowserCredential {
    if (!AzureApi.credential) {
      const authRecord = AuthRecord.load();

      AzureApi.credential = new InteractiveBrowserCredential({
        authenticationRecord: authRecord,
        disableAutomaticAuthentication: !authRecord,
        redirectUri: 'http://localhost',
        tokenCachePersistenceOptions: {
          enabled: true,
          unsafeAllowUnencryptedStorage: isWSL(),
        },
      });
    }
    return AzureApi.credential;
  },

  async _acquireToken(
    scopes: string | string[],
    { silent }: { silent: boolean } = { silent: false }
  ) {
    try {
      const cred = AzureApi.getCredential();
      const scopeArray = Array.isArray(scopes) ? scopes : [scopes];
      let result = await cred.getToken(scopeArray);

      if (!result && !silent) {
        await cred.authenticate(scopeArray);
        result = await cred.getToken(scopeArray);
      }

      if (!result) return undefined;

      return {
        token: result.token,
        expiresOnTimestamp: result.expiresOnTimestamp ?? Date.now() + 3600000,
      };
    } catch (e) {
      if (silent) return undefined;
      console.error(e);
      throw new Error('Failed to acquire token');
    }
  },

  tokenQueue: makePromiseQueue(),
  async getToken(scopes: string | string[], { silent }: { silent: boolean } = { silent: false }) {
    return AzureApi.tokenQueue.enqueuePromise(() => AzureApi._acquireToken(scopes, { silent }));
  },

  async userInfo(): Promise<{
    isLoggedIn: boolean;
    username?: string;
    tenantId?: string;
  }> {
    try {
      const result = await AzureApi.getToken('https://management.azure.com/.default', {
        silent: true,
      });
      if (!result) {
        return { isLoggedIn: false };
      }

      function parseTokenClaims(token: string): {
        upn?: string;
        preferred_username?: string;
        tid?: string;
      } {
        try {
          const payload = token.split('.')[1];
          const decoded = Buffer.from(payload, 'base64').toString('utf-8');
          return JSON.parse(decoded);
        } catch {
          return {};
        }
      }

      const claims = parseTokenClaims(result.token);
      return {
        isLoggedIn: true,
        username: claims.upn ?? claims.preferred_username,
        tenantId: claims.tid,
      };
    } catch {
      return { isLoggedIn: false };
    }
  },

  async login() {
    try {
      const cred = AzureApi.getCredential();
      const authRecord = await cred.authenticate('https://management.azure.com/.default');
      if (authRecord) {
        AuthRecord.save(authRecord);
        AzureApi.credential = undefined;
      }
      return {
        success: true,
        username: authRecord?.username,
        tenantId: authRecord?.tenantId,
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Login failed',
      };
    }
  },

  async logout() {
    try {
      AzureApi.credential = undefined;
      AuthRecord.clear();
      return { success: true };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Logout failed',
      };
    }
  },
};

export const setupAzureIPCHandlers = () => {
  ipcMain.handle('azure-get-token', async (_event, { scopes }: { scopes: string | string[] }) =>
    AzureApi.getToken(scopes)
  );

  ipcMain.handle('azure-user-info', AzureApi.userInfo);

  ipcMain.handle('azure-login', AzureApi.login);

  ipcMain.handle('azure-logout', AzureApi.logout);
};
