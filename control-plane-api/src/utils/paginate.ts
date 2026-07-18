export type TPaginated<T> = {
  items: T[];
  pages: number;
  pageRange: number[];
};

/**
 * Paginate a list of items.
 * @param items - The items to paginate
 * @param page - Zero-based page index
 * @param limit - Items per page
 * @param totalCount - Total number of items
 */
export function paginate<T>(
  items: T[],
  page: number,
  limit: number,
  totalCount: number
): TPaginated<T> {
  const pages = Math.ceil(totalCount / limit);
  
  // Generate page range (1-indexed for display)
  const pageRange: number[] = [];
  for (let i = 1; i <= pages; i++) {
    pageRange.push(i);
  }

  return {
    items,
    pages,
    pageRange,
  };
}

/**
 * Normalize page number to zero-based index.
 */
export function normalizePage(page: number): number {
  return page > 0 ? page - 1 : 0;
}
