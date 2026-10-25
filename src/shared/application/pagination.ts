export interface PageRequest {
  readonly page: number;
  readonly pageSize: number;
}

export interface Page<T> {
  readonly items: T[];
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
  readonly totalPages: number;
}

export function toPage<T>(items: T[], total: number, request: PageRequest): Page<T> {
  return {
    items,
    page: request.page,
    pageSize: request.pageSize,
    total,
    totalPages: Math.ceil(total / request.pageSize),
  };
}

export function offsetOf(request: PageRequest): number {
  return (request.page - 1) * request.pageSize;
}
