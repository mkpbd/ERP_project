/** Record names (snake_case): audit resource types and error codes (`<name>_not_found`, `<name>_in_use`). */
export const PHARMACY_RECORDS = {
  genericGroup: 'generic_group',
  generic: 'generic',
  formation: 'formation',
  strength: 'strength',
  unit: 'pharmacy_unit',
  packageUnit: 'package_unit',
  manufacturer: 'manufacturer',
  brand: 'brand',
  product: 'product',
  outlet: 'outlet',
  outletUser: 'outlet_user',
  reorderLevel: 'reorder_level',
} as const;

/** The medicine catalogue and the outlets. */
export const PHARMACY_READ = 'pharmacy:read';
/** Setting up the medicine catalogue, outlets, who works where and reorder levels. */
export const PHARMACY_MANAGE = 'pharmacy:manage';
