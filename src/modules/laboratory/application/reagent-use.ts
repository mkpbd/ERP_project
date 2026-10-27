import { Inject, Injectable } from '@nestjs/common';
import { DepartmentStock } from '../../../shared/application/contracts/department-stock.js';
import { Clock } from '../../../shared/application/ports/clock.js';
import { ReagentRepository } from '../domain/repositories.js';
import { LAB_SETTINGS, type LabSettings } from './lab.messages.js';

/**
 * Old ReAgent auto-consumption (TestAndRegAgentMappings) and XrayFilmTestMappings: a test's reagents and films used up
 * from the lab's store department the first time its result is verified or its report signed, as one department
 * consumption. It never holds the report back: when the store has too little, the use is kept as short, to be entered
 * by hand.
 */
@Injectable()
export class ReagentUser {
  constructor(
    private readonly reagents: ReagentRepository,
    private readonly stock: DepartmentStock,
    private readonly clock: Clock,
    @Inject(LAB_SETTINGS) private readonly settings: LabSettings,
  ) {}

  /** `used`, `short`, or null when the test or its department has nothing set. */
  async useUp(params: {
    sourceKind: 'result' | 'study';
    sourceId: string;
    testId: string;
    diagnosticDepartmentId: string;
    reference: string;
    by: string;
  }): Promise<'used' | 'short' | null> {
    const recipe = await this.reagents.recipe(params.testId);
    if (recipe.length === 0) return null;
    const storeDepartmentId = await this.reagents.storeOf(params.diagnosticDepartmentId);
    if (!storeDepartmentId) return null;
    const on = new Intl.DateTimeFormat('en-CA', {
      timeZone: this.settings.timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(this.clock.now());
    const consumed = await this.stock.consume({
      departmentId: storeDepartmentId,
      on,
      note: `Used for ${params.reference}`,
      lines: recipe,
      by: params.by,
    });
    await this.reagents.addUses(
      recipe.map((line) => ({
        sourceKind: params.sourceKind,
        sourceId: params.sourceId,
        testId: params.testId,
        storeDepartmentId,
        variantId: line.variantId,
        qty: line.qty,
        usedOn: on,
        consumptionNumber: consumed?.number ?? null,
      })),
    );
    return consumed ? 'used' : 'short';
  }
}
