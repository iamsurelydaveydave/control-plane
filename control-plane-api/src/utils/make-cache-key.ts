/**
 * Generate a deterministic cache key from a namespace and parameters.
 * Keys are sorted alphabetically for consistency.
 */
export function makeCacheKey(namespace: string, params: Record<string, unknown>): string {
  const sortedParams = Object.keys(params)
    .sort()
    .reduce((acc, key) => {
      acc[key] = params[key];
      return acc;
    }, {} as Record<string, unknown>);

  return `${namespace}:${JSON.stringify(sortedParams)}`;
}
