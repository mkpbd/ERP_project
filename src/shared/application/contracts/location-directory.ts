/** Read-only location lookups published by the location module. */
export abstract class LocationDirectory {
  /** The nationality word for a country (e.g. "Bangladeshi"), or null when unknown or blank. */
  abstract nationality(countryId: string): Promise<string | null>;
}
