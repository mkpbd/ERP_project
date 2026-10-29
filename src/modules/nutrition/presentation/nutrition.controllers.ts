import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Put, Query } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { z } from 'zod';
import type { Actor } from '../../../shared/application/actor.js';
import { CurrentUser, RequirePermissions } from '../../../shared/presentation/auth.decorators.js';
import { createRecordController } from '../../../shared/presentation/record-controller.js';
import {
  IdParamDto,
  recordResponseShape,
  responseDto,
  updateSchema,
} from '../../../shared/presentation/zod/common.schemas.js';
import { createZodDto } from '../../../shared/presentation/zod/zod-dto.js';
import {
  CategoryMealsQuery,
  DietOrdersQuery,
  KitchenListQuery,
  MenusQuery,
  NUTRITION_RECORDS,
  OrderDietCommand,
  RecordMealCommand,
  SetCategoryMealsCommand,
  SetMenusCommand,
  StopDietCommand,
} from '../application/nutrition.messages.js';

const mealFields = {
  name: z.string().trim().min(1).max(60),
  /** HH:MM, the organisation's time. */
  servedAt: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  isActive: z.boolean(),
};
class CreateMealTypeDto extends createZodDto(z.strictObject({ ...mealFields, isActive: z.boolean().default(true) })) {}
class UpdateMealTypeDto extends createZodDto(updateSchema(mealFields)) {}
class MealTypeFilterDto extends createZodDto(
  z.object({ q: z.string().trim().min(1).max(60).optional(), isActive: z.enum(['true', 'false']).optional() }),
) {}
class MealTypeResponseDto extends responseDto(recordResponseShape(mealFields)) {}

const planFields = {
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).nullable(),
  isActive: z.boolean(),
};
class CreateDietPlanDto extends createZodDto(
  z.strictObject({
    ...planFields,
    description: planFields.description.default(null),
    isActive: z.boolean().default(true),
  }),
) {}
class UpdateDietPlanDto extends createZodDto(updateSchema(planFields)) {}
class DietPlanFilterDto extends createZodDto(
  z.object({ q: z.string().trim().min(1).max(100).optional(), isActive: z.enum(['true', 'false']).optional() }),
) {}
class DietPlanResponseDto extends responseDto(recordResponseShape(planFields)) {}

/** Old Nutrition.MealType: breakfast, lunch, snacks, dinner, with the time each goes out. */
export const MealTypesController = createRecordController({
  tag: 'nutrition',
  readPermission: 'diet:read',
  managePermission: 'diet:manage',
  className: 'MealTypesController',
  path: 'nutrition/meal-types',
  type: NUTRITION_RECORDS.mealType,
  label: 'meal type',
  create: CreateMealTypeDto,
  update: UpdateMealTypeDto,
  response: MealTypeResponseDto,
  filter: MealTypeFilterDto,
});

/** Old FoodPatternGroup: the diets (normal, diabetic, soft, liquid …). */
export const DietPlansController = createRecordController({
  tag: 'nutrition',
  readPermission: 'diet:read',
  managePermission: 'diet:manage',
  className: 'DietPlansController',
  path: 'nutrition/diet-plans',
  type: NUTRITION_RECORDS.dietPlan,
  label: 'diet plan',
  create: CreateDietPlanDto,
  update: UpdateDietPlanDto,
  response: DietPlanResponseDto,
  filter: DietPlanFilterDto,
});

class CategoryParamDto extends createZodDto(z.object({ bedCategoryId: z.uuid() })) {}
class AdmissionParamDto extends createZodDto(z.object({ admissionId: z.uuid() })) {}
class CategoryMealsDto extends createZodDto(z.strictObject({ mealTypeIds: z.array(z.uuid()).max(12) })) {}
class MenusDto extends createZodDto(
  z.strictObject({
    menus: z.array(z.strictObject({ mealTypeId: z.uuid(), menu: z.string().max(1000) })).max(12),
  }),
) {}
class DietOrderDto extends createZodDto(
  z.strictObject({
    planId: z.uuid().nullable().default(null),
    nilByMouth: z.boolean().default(false),
    remarks: z.string().max(500).nullable().default(null),
    fromAt: z.iso
      .datetime({ offset: true })
      .transform((value) => new Date(value))
      .nullable()
      .default(null),
  }),
) {}
class MealServiceDto extends createZodDto(
  z.strictObject({
    admissionId: z.uuid(),
    mealTypeId: z.uuid(),
    day: z.iso.date(),
    status: z.enum(['served', 'refused']),
    note: z.string().max(300).nullable().default(null),
  }),
) {}
class KitchenQueryDto extends createZodDto(z.object({ day: z.iso.date(), mealTypeId: z.uuid() })) {}

const serviceShape = z.object({
  id: z.uuid(),
  admissionId: z.uuid(),
  dietOrderId: z.uuid(),
  mealTypeId: z.uuid(),
  serviceDay: z.string(),
  status: z.enum(['served', 'refused']),
  note: z.string().nullable(),
  servedBy: z.uuid(),
  servedAt: z.date(),
});
class IdResponseDto extends responseDto({ id: z.uuid() }) {}
class CategoryMealsResponseDto extends responseDto({
  items: z.array(z.object({ bedCategoryId: z.uuid(), name: z.string(), mealTypeIds: z.array(z.uuid()) })),
}) {}
class MenusResponseDto extends responseDto({ items: z.array(z.object({ mealTypeId: z.uuid(), menu: z.string() })) }) {}
class DietOrdersResponseDto extends responseDto({
  items: z.array(
    z.object({
      id: z.uuid(),
      admissionId: z.uuid(),
      patientId: z.uuid(),
      planId: z.uuid().nullable(),
      planName: z.string().nullable(),
      nilByMouth: z.boolean(),
      remarks: z.string().nullable(),
      fromAt: z.date(),
      toAt: z.date().nullable(),
      orderedBy: z.uuid(),
      orderedByName: z.string(),
      endedBy: z.uuid().nullable(),
      createdAt: z.date(),
    }),
  ),
}) {}
class KitchenListResponseDto extends responseDto({
  day: z.string(),
  mealType: z.object({ id: z.uuid(), name: z.string(), servedAt: z.string() }),
  rows: z.array(
    z.object({
      admissionId: z.uuid(),
      admissionNumber: z.string(),
      patientName: z.string(),
      uhid: z.int(),
      wardName: z.string(),
      bedCode: z.string(),
      bedCategoryName: z.string(),
      planId: z.uuid().nullable(),
      planName: z.string().nullable(),
      menu: z.string().nullable(),
      remarks: z.string().nullable(),
      state: z.enum(['to_serve', 'served', 'refused', 'nil_by_mouth', 'no_order']),
      service: serviceShape.nullable(),
    }),
  ),
  totals: z.array(z.object({ planName: z.string(), count: z.int() })),
}) {}

@ApiTags('nutrition')
@ApiBearerAuth()
@Controller({ path: 'nutrition', version: '1' })
export class NutritionController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Get('category-meals')
  @RequirePermissions('diet:read')
  @ApiOperation({ summary: 'The meals each bed category gets' })
  @ApiOkResponse({ type: CategoryMealsResponseDto })
  async categoryMeals(@CurrentUser() actor: Actor) {
    return { items: await this.queryBus.execute(new CategoryMealsQuery(actor)) };
  }

  @Put('category-meals/:bedCategoryId')
  @RequirePermissions('diet:manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  async setCategoryMeals(
    @CurrentUser() actor: Actor,
    @Param() params: CategoryParamDto,
    @Body() dto: CategoryMealsDto,
  ) {
    await this.commandBus.execute(new SetCategoryMealsCommand(actor, params.bedCategoryId, dto.mealTypeIds));
  }

  @Get('diet-plans/:id/menus')
  @RequirePermissions('diet:read')
  @ApiOkResponse({ type: MenusResponseDto })
  async menus(@CurrentUser() actor: Actor, @Param() params: IdParamDto) {
    return { items: await this.queryBus.execute(new MenusQuery(actor, params.id)) };
  }

  @Put('diet-plans/:id/menus')
  @RequirePermissions('diet:manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "The plan's menu for each meal (the whole list)" })
  @ApiNoContentResponse()
  async setMenus(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Body() dto: MenusDto) {
    await this.commandBus.execute(new SetMenusCommand(actor, params.id, dto.menus));
  }

  @Get('admissions/:admissionId/diet-orders')
  @RequirePermissions('diet:read')
  @ApiOkResponse({ type: DietOrdersResponseDto })
  async orders(@CurrentUser() actor: Actor, @Param() params: AdmissionParamDto) {
    return { items: await this.queryBus.execute(new DietOrdersQuery(actor, params.admissionId)) };
  }

  @Post('admissions/:admissionId/diet-orders')
  @RequirePermissions('diet:order')
  @ApiOperation({ summary: 'A diet plan, or nothing by mouth; it ends the diet in force' })
  @ApiCreatedResponse({ type: IdResponseDto })
  order(@CurrentUser() actor: Actor, @Param() params: AdmissionParamDto, @Body() dto: DietOrderDto) {
    return this.commandBus.execute(new OrderDietCommand(actor, params.admissionId, dto));
  }

  @Post('admissions/:admissionId/diet-orders/stop')
  @RequirePermissions('diet:order')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  async stop(@CurrentUser() actor: Actor, @Param() params: AdmissionParamDto) {
    await this.commandBus.execute(new StopDietCommand(actor, params.admissionId));
  }

  @Get('kitchen')
  @RequirePermissions('diet:read')
  @ApiOperation({ summary: "A meal's list: patients in beds that get it, their diets, menus and what was done" })
  @ApiOkResponse({ type: KitchenListResponseDto })
  kitchen(@CurrentUser() actor: Actor, @Query() query: KitchenQueryDto) {
    return this.queryBus.execute(new KitchenListQuery(actor, query.day, query.mealTypeId));
  }

  @Post('meal-services')
  @RequirePermissions('diet:serve')
  @ApiOperation({ summary: 'A meal served or refused (once per patient, meal and day)' })
  @ApiCreatedResponse({ type: IdResponseDto })
  serve(@CurrentUser() actor: Actor, @Body() dto: MealServiceDto) {
    return this.commandBus.execute(new RecordMealCommand(actor, dto));
  }
}

export const NUTRITION_CONTROLLERS = [MealTypesController, DietPlansController, NutritionController];
