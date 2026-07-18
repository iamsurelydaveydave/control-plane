/**
 * Escape special regex characters in a string for safe use in $regex queries.
 */
export function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
