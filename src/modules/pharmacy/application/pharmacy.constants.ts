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
  productDiscount: 'product_discount',
  loyalMember: 'loyal_member',
  reorderLevel: 'reorder_level',
} as const;

/** The medicine catalogue and the outlets. */
export const PHARMACY_READ = 'pharmacy:read';
/** Setting up the medicine catalogue, outlets, who works where and reorder levels; opening stock. */
export const PHARMACY_MANAGE = 'pharmacy:manage';
/** Raising, editing, cancelling and closing purchase orders. */
export const PHARMACY_PURCHASE = 'pharmacy:purchase';
/** Drafting and posting stock receives at the outlets one works at. */
export const PHARMACY_RECEIVE = 'pharmacy:receive';
/** Paying suppliers for posted receives. */
export const PHARMACY_PAYMENT = 'pharmacy:payment';
/** Raising outlet indents, sending transfers and accepting them, at the outlets one works at. */
export const PHARMACY_TRANSFER = 'pharmacy:transfer';
/** Selling over the counter at the outlets one works at, and collecting loyal members' dues. */
export const PHARMACY_SELL = 'pharmacy:sell';
/** Opening, counting and cancelling stock counts at the outlets one works at (applying needs pharmacy:manage). */
export const PHARMACY_COUNT = 'pharmacy:count';
