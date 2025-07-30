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

import { useEffect, useState } from 'react';
import { ConfigState } from '../../../redux/configSlice';
import { useTypedSelector } from '../../../redux/hooks';

export function useSettings(): ConfigState['settings'];
export function useSettings<T extends string>(settingName: T): ConfigState['settings'][T];
export function useSettings(settingName?: string) {
  const storeSettingEntries = useTypedSelector(state =>
    settingName ? state.config.settings[settingName] : state.config.settings
  );
  const [settingEntries, setSettingEntries] = useState(storeSettingEntries);

  useEffect(() => {
    setSettingEntries(settingEntries);
  }, [storeSettingEntries]);

  return settingEntries;
}
