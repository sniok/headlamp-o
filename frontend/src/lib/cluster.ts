import { matchPath } from 'react-router';
import helpers from '../helpers';

/**
 * @returns A path prefixed with cluster path, and the given path.
 *
 * The given path does not start with a /, it will be added.
 */
export function getClusterPrefixedPath(path?: string | null) {
  const baseClusterPath = '/c/:cluster';
  if (!path) {
    return baseClusterPath;
  }
  return baseClusterPath + (path[0] === '/' ? '' : '/') + path;
}

/**
 * @returns The current cluster name, or null if not in a cluster context.
 */
export function getCluster(): string | null {
  const clusterString = getClusterPathParam();
  if (!clusterString) return null;

  if (clusterString.includes('+')) {
    return clusterString.split('+')[0];
  }
  return clusterString;
}

/** Get raw cluster param. Only use for creating links */
export function getClusterPathParam(): string | undefined {
  const prefix = helpers.getBaseUrl();
  const urlPath = helpers.isElectron()
    ? window.location.hash.substring(1)
    : window.location.pathname.slice(prefix.length);

  const clusterURLMatch = matchPath<{ cluster?: string }>(urlPath, {
    path: getClusterPrefixedPath(),
  });

  return clusterURLMatch?.params?.cluster;
}
