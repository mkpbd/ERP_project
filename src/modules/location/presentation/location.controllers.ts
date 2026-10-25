import { createRecordController } from '../../../shared/presentation/record-controller.js';
import { COUNTRY, DISTRICT, DIVISION } from '../application/record-types.js';
import {
  CountryResponseDto,
  CreateCountryDto,
  CreateDistrictDto,
  CreateDivisionDto,
  DistrictFilterDto,
  DistrictResponseDto,
  DivisionResponseDto,
  UpdateCountryDto,
  UpdateDistrictDto,
  UpdateDivisionDto,
} from './dto/location.dto.js';

const common = { tag: 'locations', managePermission: 'locations:manage' } as const;

export const CountriesController = createRecordController({
  ...common,
  className: 'CountriesController',
  path: 'locations/countries',
  type: COUNTRY,
  label: 'country',
  create: CreateCountryDto,
  update: UpdateCountryDto,
  response: CountryResponseDto,
});

export const DivisionsController = createRecordController({
  ...common,
  className: 'DivisionsController',
  path: 'locations/divisions',
  type: DIVISION,
  label: 'division',
  create: CreateDivisionDto,
  update: UpdateDivisionDto,
  response: DivisionResponseDto,
});

export const DistrictsController = createRecordController({
  ...common,
  className: 'DistrictsController',
  path: 'locations/districts',
  type: DISTRICT,
  label: 'district',
  create: CreateDistrictDto,
  update: UpdateDistrictDto,
  response: DistrictResponseDto,
  filter: DistrictFilterDto,
});
