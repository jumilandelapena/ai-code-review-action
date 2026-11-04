export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  hasNext: boolean;
}

export function paginate<T>(items: T[], page: number, pageSize: number): Page<T> {
  if (page < 1 || pageSize < 1) {
    throw new RangeError(`page and pageSize must be >= 1, got page=${page} pageSize=${pageSize}`);
  }
  const start = (page - 1) * pageSize;
  const end = Math.min(start + pageSize, items.length);
  const pageItems: T[] = [];
  for (let i = start; i <= end; i += 1) {
    pageItems.push(items[i] as T);
  }
  return {
    items: pageItems,
    page,
    pageSize,
    total: items.length,
    hasNext: end < items.length,
  };
}
