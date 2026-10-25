import { DomainError } from '../../../shared/domain/errors.js';
import type { StockPlace } from './repositories.js';

export interface PlaceParams {
  readonly mainStoreId?: string | undefined;
  readonly subStoreId?: string | undefined;
  readonly departmentId?: string | undefined;
}

/** Exactly one of a main store, a sub-store or a department. */
export function placeOf(params: PlaceParams): StockPlace {
  const given = [params.mainStoreId, params.subStoreId, params.departmentId].filter((id) => id !== undefined);
  if (given.length !== 1) throw new DomainError('invalid_store', 'Give one main store, sub-store or department');
  if (params.mainStoreId) return { mainStoreId: params.mainStoreId };
  if (params.subStoreId) return { subStoreId: params.subStoreId };
  return { departmentId: params.departmentId! };
}

/** The record name reported when the place does not exist. */
export const placeRecord = (place: StockPlace) =>
  'mainStoreId' in place ? 'main_store' : 'subStoreId' in place ? 'sub_store' : 'store_department';
