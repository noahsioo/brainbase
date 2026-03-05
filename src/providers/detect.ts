import { existsSync } from 'fs';
import { PROVIDER_PATHS, type ProviderName } from '../config.js';

export interface ProviderInfo {
  name: ProviderName;
  installed: boolean;
  path: string;
}

export function detectProviders(): ProviderInfo[] {
  return (Object.keys(PROVIDER_PATHS) as ProviderName[]).map((name) => {
    const config = PROVIDER_PATHS[name];
    const mainDir = existsSync(config.dir);
    const altDir = 'altDir' in config && typeof config.altDir === 'string'
      ? existsSync(config.altDir) : false;
    const confFile = 'confFile' in config && typeof config.confFile === 'string'
      ? existsSync(config.confFile) : false;

    return {
      name,
      installed: mainDir || altDir || confFile,
      path: config.dir,
    };
  });
}

export function getInstalledProviders(): ProviderInfo[] {
  return detectProviders().filter((p) => p.installed);
}
