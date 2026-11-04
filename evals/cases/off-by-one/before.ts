export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export function paginate<T>(items: T[], page: number, pageSize: number): Page<T> {
  return { items: items.slice(0, pageSize), page, pageSize, total: items.length };
}
