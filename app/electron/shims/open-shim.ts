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

/**
 * Shim for the `open` package used in Electron builds.
 * Electron should open external URLs via `shell.openExternal`.
 */

import { shell } from 'electron';

export default async function open(target: string | URL) {
  await shell.openExternal(String(target));
}

export const apps = {};

export async function openApp(): Promise<never> {
  throw new Error('openApp is not supported in the Electron open shim');
}
