import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { CommandHandler, QueryHandler, type ICommandHandler, type IQueryHandler } from '@nestjs/cqrs';
import type { Actor } from '../../../shared/application/actor.js';
import {
  InpatientRegister,
  type ChargeableAdmission,
} from '../../../shared/application/contracts/inpatient-register.js';
import type { LedgerPostingLine } from '../../../shared/application/contracts/ledger-posting.js';
import { ConflictError, DomainError, NotFoundError } from '../../../shared/domain/errors.js';
import { DEFAULT_POLICY, discountPercent } from '../domain/discount.js';
import { MAX_DOCUMENT_LINES, text, validUnits } from '../domain/documents.js';
import { DiscountRules, WardRepository } from '../domain/repositories.js';
import type { SalePart } from '../domain/sale.js';
import { WardIndent, WardIssue } from '../domain/ward.js';
import { PHARMACY_READ, PHARMACY_SELL } from './pharmacy.constants.js';
import { PHARMACY_INVENTORY_ROLE, PharmacyDesk, PURCHASE_JOURNAL } from './purchase.handlers.js';
import { PHARMACY_COGS_ROLE, PHARMACY_DISCOUNT_ROLE, PHARMACY_SALES_ROLE } from './sale.handlers.js';
import { PharmacyKeeper } from './stock-keeper.js';
import {
  CancelWardIndentCommand,
  GetWardIndentQuery,
  GetWardIssueQuery,
  IPD_MEDICINE_ROLE,
  IssueToWardCommand,
  ListWardIndentsQuery,
  ListWardIssuesQuery,
  PHARMACY_WARD,
  RaiseWardIndentCommand,
  ReturnFromWardCommand,
  WardReadRepository,
  type AdmissionRef,
} from './ward.messages.js';

/** What the ward handlers share on top of the pharmacy desk. */
@Injectable()
export class WardDesk {
  constructor(
    readonly desk: PharmacyDesk,
    readonly keeper: PharmacyKeeper,
    readonly rules: DiscountRules,
    readonly wards: WardRepository,
    readonly read: WardReadRepository,
    readonly register: InpatientRegister,
  ) {}

  /**
   * The admission, locked against its final bill: still in, and not billed (old: no charge once the pharmacy had
   * cleared the patient). A document is not dated before the admission.
   */
  async chargeable(admissionId: string, on: string): Promise<ChargeableAdmission> {
    const admission = await this.register.lockForCharge(admissionId);
    if (!admission) throw new NotFoundError('admission');
    if (admission.status !== 'admitted') {
      throw new DomainError('admission_state', `Admission ${admission.number} is ${admission.status}`);
    }
    if (admission.billed) {
      throw new ConflictError('bill_made', `The final bill of ${admission.number} is made; it must be cancelled first`);
    }
    if (on < admission.admittedOn) {
      throw new DomainError('invalid_date', `${admission.number} was admitted on ${admission.admittedOn}`);
    }
    return admission;
  }

  /** Product → the indoor discount percent (old ProductDiscountSetting.IpdDiscountPercent). */
  async percents(productIds: readonly string[]): Promise<Map<string, number>> {
    const policy = (await this.rules.policy()) ?? DEFAULT_POLICY;
    const own = await this.rules.productRules(productIds);
    return new Map(productIds.map((id) => [id, discountPercent(policy, own.get(id) ?? null, 'ipd')]));
  }

  async activeProducts(productIds: readonly string[]): Promise<void> {
    const products = await this.desk.facts.products(productIds);
    productIds.forEach((id, index) => {
      const product = products.get(id);
      if (!product) throw new NotFoundError('product');
      if (!product.isActive) throw new DomainError('inactive_product', `Line ${index + 1}: the product is inactive`);
    });
  }

  /** The admission each row is for, as the hospital tells it. */
  async withAdmissions<T extends { admissionId: string }>(rows: readonly T[]): Promise<(T & AdmissionRef)[]> {
    const found = await this.register.find([...new Set(rows.map((row) => row.admissionId))]);
    const byId = new Map(found.map((admission) => [admission.id, admission]));
    return rows.map((row) => {
      const admission = byId.get(row.admissionId);
      return {
        ...row,
        admissionNumber: admission?.number ?? null,
        patientName: admission?.patientName ?? null,
        uhid: admission?.uhid ?? null,
      };
    });
  }

  async post(narration: string, on: string, reference: string, lines: LedgerPostingLine[], actor: Actor) {
    const posted = lines.filter((line) => line.debit > 0 || line.credit > 0);
    if (posted.length === 0) return null;
    return this.desk.posting.post({
      journal: PURCHASE_JOURNAL,
      voucherDate: on,
      narration,
      source: { module: 'pharmacy', reference },
      lines: posted,
      postedBy: actor.userId,
    });
  }
}

/** Old Medicine Indent page (nurse station, priority, the outlet fixed by the user's settings). */
@CommandHandler(RaiseWardIndentCommand)
export class RaiseWardIndentHandler implements ICommandHandler<RaiseWardIndentCommand> {
  constructor(private readonly ward: WardDesk) {}

  async execute({ actor, input }: RaiseWardIndentCommand) {
    const { desk } = this.ward;
    await desk.access.authorize(actor.userId, { permissions: [PHARMACY_WARD] });
    if (input.lines.length === 0 || input.lines.length > MAX_DOCUMENT_LINES) {
      throw new DomainError('invalid_lines', `An indent has 1 to ${MAX_DOCUMENT_LINES} lines`);
    }
    return desk.tx.run(async () => {
      if (!(await desk.facts.outletExists(input.outletId))) throw new NotFoundError('outlet');
      await this.ward.chargeable(input.admissionId, input.requestedOn);
      await this.ward.activeProducts(input.lines.map((line) => line.productId));
      const indent = WardIndent.raise({
        id: randomUUID(),
        number: await desk.number('WN', input.requestedOn),
        outletId: input.outletId,
        admissionId: input.admissionId,
        requestedOn: input.requestedOn,
        note: input.note,
        lines: input.lines,
        by: actor.userId,
        now: desk.clock.now(),
      });
      await this.ward.wards.insertIndent(indent);
      await desk.record('ward_indent', 'raised', actor, indent.id, { number: indent.number });
      return { id: indent.id, number: indent.number };
    });
  }
}

/** Old indent dashboard cancel (the whole indent; lines were cancelled one by one there). */
@CommandHandler(CancelWardIndentCommand)
export class CancelWardIndentHandler implements ICommandHandler<CancelWardIndentCommand> {
  constructor(private readonly ward: WardDesk) {}

  async execute({ actor, id, version, reason }: CancelWardIndentCommand): Promise<void> {
    const { desk } = this.ward;
    const fromWard = await desk.access.isAllowed(actor.userId, { permissions: [PHARMACY_WARD] });
    if (!fromWard) await desk.access.authorize(actor.userId, { permissions: [PHARMACY_SELL] });
    await desk.tx.run(async () => {
      const indent = await this.ward.wards.indentForUpdate(id);
      if (!indent) throw new NotFoundError('ward_indent');
      indent.assertVersion(version);
      if (!fromWard) await desk.assertWorksAt(actor.userId, indent.outletId);
      indent.cancel(reason, actor.userId, desk.clock.now());
      await this.ward.wards.updateIndent(indent);
      await desk.record('ward_indent', 'cancelled', actor, id, { number: indent.number, reason });
    });
  }
}

/**
 * Old Pharmacy IPD Sale (CreateIPDPharmacySaleTxnCommand: an invoice with the patient's IPD record, nothing paid, never
 * posted): medicine sent from an outlet to a ward, first expiring first, each part at its lot's sale rate less the
 * product's indoor discount, charged to the admission until its final bill takes it. An open indent of the admission
 * at the outlet is answered by it. One voucher: Dr medicine charged to stays and the sales discount / Cr pharmacy
 * sales (gross); Dr cost of medicines sold / Cr pharmacy inventory at cost.
 */
@CommandHandler(IssueToWardCommand)
export class IssueToWardHandler implements ICommandHandler<IssueToWardCommand> {
  constructor(private readonly ward: WardDesk) {}

  async execute({ actor, input }: IssueToWardCommand) {
    const { desk, keeper } = this.ward;
    await desk.access.authorize(actor.userId, { permissions: [PHARMACY_SELL] });
    if (input.lines.length === 0 || input.lines.length > MAX_DOCUMENT_LINES) {
      throw new DomainError('invalid_lines', `An issue has 1 to ${MAX_DOCUMENT_LINES} lines`);
    }
    input.lines.forEach((line, index) => validUnits(line.qty, `Line ${index + 1}`));
    return desk.tx.run(async () => {
      await desk.assertWorksAt(actor.userId, input.outletId);
      const admission = await this.ward.chargeable(input.admissionId, input.issuedOn);
      const indent = input.indentId ? await this.ward.wards.indentForUpdate(input.indentId) : null;
      if (input.indentId && !indent) throw new NotFoundError('ward_indent');
      if (indent && (indent.admissionId !== admission.id || indent.outletId !== input.outletId)) {
        throw new DomainError('indent_mismatch', 'The indent is for another admission or outlet');
      }
      const productIds = input.lines.map((line) => line.productId);
      await this.ward.activeProducts(productIds);
      const id = randomUUID();
      const number = await desk.number('WI', input.issuedOn);
      const percents = await this.ward.percents(productIds);
      const taken = await keeper.takeOut(input.outletId, input.lines, { id, number, on: input.issuedOn }, 'ward_issue');
      const parts: SalePart[] = taken.map((part) => ({
        productId: part.productId,
        lotId: part.lotId,
        qty: part.qty,
        saleRate: part.saleRate,
        unitCost: part.unitCost,
        discountPercent: percents.get(part.productId) ?? 0,
      }));
      const now = desk.clock.now();
      const issue = WardIssue.make({
        id,
        number,
        outletId: input.outletId,
        admissionId: admission.id,
        indentId: indent?.id ?? null,
        issuedOn: input.issuedOn,
        parts,
        by: actor.userId,
        now,
      });
      const narration = `Medicine to the ward ${number} (${admission.number})`;
      const voucher = await this.ward.post(
        narration,
        input.issuedOn,
        id,
        [
          { account: { role: IPD_MEDICINE_ROLE }, debit: issue.total, credit: 0, narration },
          { account: { role: PHARMACY_DISCOUNT_ROLE }, debit: issue.discount, credit: 0, narration },
          { account: { role: PHARMACY_SALES_ROLE }, debit: 0, credit: issue.amount, narration },
          { account: { role: PHARMACY_COGS_ROLE }, debit: issue.cost, credit: 0, narration },
          { account: { role: PHARMACY_INVENTORY_ROLE }, debit: 0, credit: issue.cost, narration },
        ],
        actor,
      );
      issue.posted(voucher?.number ?? null);
      await this.ward.wards.insertIssue(issue);
      if (indent) {
        indent.issued(id, actor.userId, now);
        await this.ward.wards.updateIndent(indent);
      }
      await desk.record('ward_issue', 'made', actor, id, {
        number,
        admission: admission.number,
        total: issue.total,
        voucher: voucher?.number ?? null,
      });
      return { id, number, total: issue.total };
    });
  }
}

/**
 * Old Medicine Return Indent and ProcessIpdMedicineReturnCommand (a negative invoice, the stock received back against
 * a pseudo-supplier): unused medicine sent back from the ward before the final bill, put back into the outlet's stock
 * at its cost and taken off the admission's charge at what it was charged.
 */
@CommandHandler(ReturnFromWardCommand)
export class ReturnFromWardHandler implements ICommandHandler<ReturnFromWardCommand> {
  constructor(private readonly ward: WardDesk) {}

  async execute({ actor, issueId, version, returnedOn, lines, reason }: ReturnFromWardCommand) {
    const { desk, keeper } = this.ward;
    await desk.access.authorize(actor.userId, { permissions: [PHARMACY_SELL] });
    return desk.tx.run(async () => {
      const peek = await this.ward.read.issue(issueId);
      if (!peek) throw new NotFoundError('ward_issue');
      // The admission first, as every charge and the final bill lock it.
      const admission = await this.ward.chargeable(peek.admissionId, returnedOn);
      const issue = await this.ward.wards.issueForUpdate(issueId);
      if (!issue) throw new NotFoundError('ward_issue');
      issue.assertVersion(version);
      await desk.assertWorksAt(actor.userId, issue.outletId);
      if (returnedOn < peek.issuedOn) {
        throw new DomainError('invalid_date', 'Medicine does not come back before it was sent');
      }
      const given = issue.giveBack(lines, desk.clock.now());
      const id = randomUUID();
      const number = await desk.number('WR', returnedOn);
      await keeper.putIn(issue.outletId, given.parts, { id, number, on: returnedOn }, 'ward_return');
      const narration = `Medicine back from the ward ${number} (${admission.number}, ${issue.number})`;
      const voucher = await this.ward.post(
        narration,
        returnedOn,
        id,
        [
          { account: { role: PHARMACY_SALES_ROLE }, debit: given.amount, credit: 0, narration },
          { account: { role: PHARMACY_DISCOUNT_ROLE }, debit: 0, credit: given.discount, narration },
          { account: { role: IPD_MEDICINE_ROLE }, debit: 0, credit: given.total, narration },
          { account: { role: PHARMACY_INVENTORY_ROLE }, debit: given.cost, credit: 0, narration },
          { account: { role: PHARMACY_COGS_ROLE }, debit: 0, credit: given.cost, narration },
        ],
        actor,
      );
      await this.ward.wards.updateIssue(issue);
      await this.ward.wards.insertReturn({
        id,
        number,
        issueId,
        returnedOn,
        reason: text(reason, 300, 'reason', 'Return'),
        amount: given.amount,
        discount: given.discount,
        total: given.total,
        cost: given.cost,
        voucherNumber: voucher?.number ?? null,
        returnedBy: actor.userId,
        parts: given.parts,
      });
      await desk.record('ward_return', 'made', actor, id, { number, issue: issue.number, total: given.total });
      return { id, number, total: given.total, charged: issue.charged };
    });
  }
}

/** Ward documents are seen by the wards and by the pharmacy. */
async function authorizeRead(desk: PharmacyDesk, actor: Actor): Promise<void> {
  if (await desk.access.isAllowed(actor.userId, { permissions: [PHARMACY_WARD] })) return;
  await desk.access.authorize(actor.userId, { permissions: [PHARMACY_READ] });
}

@QueryHandler(ListWardIndentsQuery)
export class ListWardIndentsHandler implements IQueryHandler<ListWardIndentsQuery> {
  constructor(private readonly ward: WardDesk) {}

  async execute({ actor, filter }: ListWardIndentsQuery) {
    await authorizeRead(this.ward.desk, actor);
    const page = await this.ward.read.indents(filter);
    return { ...page, items: await this.ward.withAdmissions(page.items) };
  }
}

@QueryHandler(GetWardIndentQuery)
export class GetWardIndentHandler implements IQueryHandler<GetWardIndentQuery> {
  constructor(private readonly ward: WardDesk) {}

  async execute({ actor, id }: GetWardIndentQuery) {
    await authorizeRead(this.ward.desk, actor);
    const indent = await this.ward.read.indent(id);
    if (!indent) throw new NotFoundError('ward_indent');
    return (await this.ward.withAdmissions([indent]))[0]!;
  }
}

@QueryHandler(ListWardIssuesQuery)
export class ListWardIssuesHandler implements IQueryHandler<ListWardIssuesQuery> {
  constructor(private readonly ward: WardDesk) {}

  async execute({ actor, filter }: ListWardIssuesQuery) {
    await authorizeRead(this.ward.desk, actor);
    const page = await this.ward.read.issues(filter);
    return { ...page, items: await this.ward.withAdmissions(page.items) };
  }
}

@QueryHandler(GetWardIssueQuery)
export class GetWardIssueHandler implements IQueryHandler<GetWardIssueQuery> {
  constructor(private readonly ward: WardDesk) {}

  async execute({ actor, id }: GetWardIssueQuery) {
    await authorizeRead(this.ward.desk, actor);
    const issue = await this.ward.read.issue(id);
    if (!issue) throw new NotFoundError('ward_issue');
    return (await this.ward.withAdmissions([issue]))[0]!;
  }
}

export const WARD_HANDLERS = [
  WardDesk,
  RaiseWardIndentHandler,
  CancelWardIndentHandler,
  IssueToWardHandler,
  ReturnFromWardHandler,
  ListWardIndentsHandler,
  GetWardIndentHandler,
  ListWardIssuesHandler,
  GetWardIssueHandler,
];
