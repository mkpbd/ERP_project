import { z } from 'zod';
import { recordResponseShape, responseDto, updateSchema } from '../../../../shared/presentation/zod/common.schemas.js';
import { createZodDto } from '../../../../shared/presentation/zod/zod-dto.js';

const name = z.string().trim().min(1).max(100);

const countryFields = {
  name,
  nationality: z.string().trim().max(100),
  shortCode: z.string().trim().min(1).max(10).nullable(),
};

export class CreateCountryDto extends createZodDto(
  z.strictObject({
    ...countryFields,
    nationality: countryFields.nationality.default(''),
    shortCode: countryFields.shortCode.default(null),
  }),
) {}
export class UpdateCountryDto extends createZodDto(updateSchema(countryFields)) {}
export class CountryResponseDto extends responseDto(
  recordResponseShape({ name: z.string(), nationality: z.string(), shortCode: z.string().nullable() }),
) {}

const divisionFields = { name };

export class CreateDivisionDto extends createZodDto(z.strictObject(divisionFields)) {}
export class UpdateDivisionDto extends createZodDto(updateSchema(divisionFields)) {}
export class DivisionResponseDto extends responseDto(recordResponseShape({ name: z.string() })) {}

const districtFields = {
  divisionId: z.uuid(),
  name,
  nameBn: z.string().trim().min(1).max(100).nullable(),
};

export class CreateDistrictDto extends createZodDto(
  z.strictObject({ ...districtFields, nameBn: districtFields.nameBn.default(null) }),
) {}
export class UpdateDistrictDto extends createZodDto(updateSchema(districtFields)) {}
export class DistrictFilterDto extends createZodDto(z.object({ divisionId: z.uuid().optional() })) {}
export class DistrictResponseDto extends responseDto(
  recordResponseShape({ divisionId: z.uuid(), name: z.string(), nameBn: z.string().nullable() }),
) {}
