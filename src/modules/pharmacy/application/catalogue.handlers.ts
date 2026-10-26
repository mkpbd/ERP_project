import { Query, QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import type { Actor } from '../../../shared/application/actor.js';
import { AccessControl } from '../../../shared/application/contracts/access-control.js';
import type { Page, PageRequest } from '../../../shared/application/pagination.js';
import { PHARMACY_READ } from './pharmacy.constants.js';

export interface CatalogueEntry {
  readonly id: string;
  /** As printed on bills and labels: formation (short), brand, strength — "Tab. Napa 500 mg". */
  readonly displayName: string;
  readonly brandName: string;
  readonly formationName: string;
  readonly formationShortName: string | null;
  readonly strength: string | null;
  readonly genericName: string;
  readonly genericGroupName: string | null;
  readonly manufacturerName: string;
  readonly unitName: string | null;
  readonly packageUnitName: string | null;
  readonly unitsPerPack: number;
  readonly purchasePrice: number;
  readonly salePrice: number;
  readonly barcode: string | null;
  readonly isActive: boolean;
}

export interface CatalogueFilter extends PageRequest {
  /** Brand, generic or barcode, anywhere in the text. */
  readonly q?: string | undefined;
  readonly genericId?: string | undefined;
  readonly manufacturerId?: string | undefined;
  readonly formationId?: string | undefined;
  readonly isActive?: boolean | undefined;
}

export abstract class CatalogueReadRepository {
  abstract search(filter: CatalogueFilter): Promise<Page<CatalogueEntry>>;
}

export const displayName = (entry: {
  brandName: string;
  formationName: string;
  formationShortName: string | null;
  strength: string | null;
}) => [entry.formationShortName ?? entry.formationName, entry.brandName, entry.strength].filter(Boolean).join(' ');

/** Old BrandDetails view and GetAllBrandDetails / GetBrandDetailsSummaryList: products with their names. */
export class SearchCatalogueQuery extends Query<Page<CatalogueEntry>> {
  constructor(
    readonly actor: Actor,
    readonly filter: CatalogueFilter,
  ) {
    super();
  }
}

@QueryHandler(SearchCatalogueQuery)
export class SearchCatalogueHandler implements IQueryHandler<SearchCatalogueQuery> {
  constructor(
    private readonly read: CatalogueReadRepository,
    private readonly access: AccessControl,
  ) {}

  async execute({ actor, filter }: SearchCatalogueQuery): Promise<Page<CatalogueEntry>> {
    await this.access.authorize(actor.userId, { permissions: [PHARMACY_READ] });
    return this.read.search(filter);
  }
}

export const CATALOGUE_HANDLERS = [SearchCatalogueHandler];
