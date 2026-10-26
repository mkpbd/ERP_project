import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { CommandHandler, QueryHandler, type ICommandHandler, type IQueryHandler } from '@nestjs/cqrs';
import { AccessControl } from '../../../shared/application/contracts/access-control.js';
import { Clock } from '../../../shared/application/ports/clock.js';
import { DomainError, NotFoundError } from '../../../shared/domain/errors.js';
import { MAX_DOCUMENT_LINES, text, validUnits } from '../domain/documents.js';
import { OutletIndent } from '../domain/outlet-indent.js';
import { IndentRepository, TransferRepository } from '../domain/repositories.js';
import { OutletTransfer } from '../domain/transfer.js';
import { PHARMACY_READ, PHARMACY_TRANSFER } from './pharmacy.constants.js';
import { PharmacyDesk } from './purchase.handlers.js';
import { PharmacyKeeper } from './stock-keeper.js';
import {
  DecideTransferCommand,
  EditIndentCommand,
  EndIndentCommand,
  GetIndentQuery,
  GetTransferQuery,
  ListIndentsQuery,
  ListTransfersQuery,
  RaiseIndentCommand,
  SendTransferCommand,
  TransferReadRepository,
} from './transfer.messages.js';

/** What the indent and transfer handlers share on top of the pharmacy desk. */
@Injectable()
export class TransferDesk {
  constructor(
    readonly desk: PharmacyDesk,
    readonly keeper: PharmacyKeeper,
    readonly indents: IndentRepository,
    readonly transfers: TransferRepository,
  ) {}

  async indent(id: string, version?: number): Promise<OutletIndent> {
    const indent = await this.indents.findForUpdate(id);
    if (!indent) throw new NotFoundError('outlet_indent');
    if (version !== undefined) indent.assertVersion(version);
    return indent;
  }

  async transfer(id: string, version: number): Promise<OutletTransfer> {
    const transfer = await this.transfers.findForUpdate(id);
    if (!transfer) throw new NotFoundError('transfer');
    transfer.assertVersion(version);
    return transfer;
  }
}

@CommandHandler(RaiseIndentCommand)
export class RaiseIndentHandler implements ICommandHandler<RaiseIndentCommand> {
  constructor(private readonly transfers: TransferDesk) {}

  async execute(command: RaiseIndentCommand) {
    const { desk, indents } = this.transfers;
    const { actor, requestingOutletId, supplyingOutletId, lines } = command;
    await desk.access.authorize(actor.userId, { permissions: [PHARMACY_TRANSFER] });
    return desk.tx.run(async () => {
      await desk.assertWorksAt(actor.userId, requestingOutletId);
      if (!(await desk.facts.outletExists(supplyingOutletId))) throw new NotFoundError('outlet');
      await desk.facts.products(lines.map((line) => line.productId));
      const indent = OutletIndent.raise({
        id: randomUUID(),
        number: await desk.number('OI', command.indentDate),
        requestingOutletId,
        supplyingOutletId,
        indentDate: command.indentDate,
        urgent: command.urgent,
        note: command.note,
        lines,
        createdBy: actor.userId,
        now: desk.clock.now(),
      });
      await indents.insert(indent);
      await desk.record('outlet_indent', 'raised', actor, indent.id, { number: indent.number });
      return { id: indent.id, number: indent.number };
    });
  }
}

@CommandHandler(EditIndentCommand)
export class EditIndentHandler implements ICommandHandler<EditIndentCommand> {
  constructor(private readonly transfers: TransferDesk) {}

  async execute({ actor, id, version, changes }: EditIndentCommand): Promise<void> {
    const { desk, indents } = this.transfers;
    await desk.access.authorize(actor.userId, { permissions: [PHARMACY_TRANSFER] });
    await desk.tx.run(async () => {
      const indent = await this.transfers.indent(id, version);
      await desk.assertWorksAt(actor.userId, indent.requestingOutletId);
      if (changes.lines) await desk.facts.products(changes.lines.map((line) => line.productId));
      indent.edit(changes, desk.clock.now());
      await indents.update(indent);
      await desk.record('outlet_indent', 'edited', actor, id);
    });
  }
}

/** Cancelled by the outlet that asked; closed (partly transferred) by either outlet. */
@CommandHandler(EndIndentCommand)
export class EndIndentHandler implements ICommandHandler<EndIndentCommand> {
  constructor(private readonly transfers: TransferDesk) {}

  async execute({ actor, id, version, action, reason }: EndIndentCommand): Promise<void> {
    const { desk, indents } = this.transfers;
    await desk.access.authorize(actor.userId, { permissions: [PHARMACY_TRANSFER] });
    await desk.tx.run(async () => {
      const indent = await this.transfers.indent(id, version);
      if (action === 'cancel') {
        await desk.assertWorksAt(actor.userId, indent.requestingOutletId);
        indent.cancel(reason, desk.clock.now());
      } else {
        const works =
          (await desk.facts.worksAt(actor.userId, indent.requestingOutletId)) ||
          (await desk.facts.worksAt(actor.userId, indent.supplyingOutletId));
        if (!works) await desk.assertWorksAt(actor.userId, indent.supplyingOutletId);
        indent.close(reason, desk.clock.now());
      }
      await indents.update(indent);
      await desk.record('outlet_indent', action === 'cancel' ? 'cancelled' : 'closed', actor, id, { reason });
    });
  }
}

/**
 * Old ProcessStockTransfer: the sending outlet's stock leaves by lot, first expiring first and never an expired
 * lot (or the lot named), and is in transit. Against an indent, the outlets are the indent's and nothing is sent
 * beyond what was asked for.
 */
@CommandHandler(SendTransferCommand)
export class SendTransferHandler implements ICommandHandler<SendTransferCommand> {
  constructor(private readonly transfers: TransferDesk) {}

  async execute(command: SendTransferCommand) {
    const { desk, keeper, indents, transfers } = this.transfers;
    const { actor, fromOutletId, toOutletId, indentId, transferDate, lines } = command;
    await desk.access.authorize(actor.userId, { permissions: [PHARMACY_TRANSFER] });
    if (lines.length === 0 || lines.length > MAX_DOCUMENT_LINES) {
      throw new DomainError('invalid_lines', `A transfer has 1 to ${MAX_DOCUMENT_LINES} lines`);
    }
    lines.forEach((line, index) => validUnits(line.qty, `Line ${index + 1}`));
    const note = text(command.note, 1000, 'note', 'Transfer');
    return desk.tx.run(async () => {
      await desk.assertWorksAt(actor.userId, fromOutletId);
      if (!(await desk.facts.outletExists(toOutletId))) throw new NotFoundError('outlet');
      if (fromOutletId === toOutletId) throw new DomainError('same_outlet', 'An outlet does not transfer to itself');
      await desk.facts.products(lines.map((line) => line.productId));
      const indent = indentId ? await this.transfers.indent(indentId) : null;
      if (indent && (indent.supplyingOutletId !== fromOutletId || indent.requestingOutletId !== toOutletId)) {
        throw new DomainError('indent_mismatch', 'The indent is between other outlets');
      }
      const id = randomUUID();
      const number = await desk.number('TT', transferDate);
      const taken = await keeper.takeOut(fromOutletId, lines, { id, number, on: transferDate }, 'transfer_out');
      const transfer = OutletTransfer.send({
        id,
        number,
        indentId,
        fromOutletId,
        toOutletId,
        transferDate,
        note,
        lines: taken.map((part) => ({
          productId: part.productId,
          lotId: part.lotId,
          qty: part.qty,
          unitCost: part.unitCost,
        })),
        createdBy: actor.userId,
        now: desk.clock.now(),
      });
      if (indent) {
        indent.transfer(transfer.quantities(), desk.clock.now());
        await indents.update(indent);
      }
      await transfers.insert(transfer);
      await desk.record('transfer', 'sent', actor, id, { number, indent: indent?.number ?? null });
      return { id, number };
    });
  }
}

/**
 * Old ProcessAcceptOutletTransfer: the receiving outlet takes the stock into the same lots at the same cost. A
 * rejection puts it back into the sending outlet and gives the quantities back to the indent.
 */
@CommandHandler(DecideTransferCommand)
export class DecideTransferHandler implements ICommandHandler<DecideTransferCommand> {
  constructor(private readonly transfers: TransferDesk) {}

  async execute({ actor, id, version, decision, on, reason }: DecideTransferCommand): Promise<void> {
    const { desk, keeper, indents, transfers } = this.transfers;
    await desk.access.authorize(actor.userId, { permissions: [PHARMACY_TRANSFER] });
    await desk.tx.run(async () => {
      const transfer = await this.transfers.transfer(id, version);
      await desk.assertWorksAt(actor.userId, transfer.toOutletId);
      const now = desk.clock.now();
      const document = { id: transfer.id, number: transfer.number, on };
      if (decision === 'accept') {
        transfer.accept({ on, by: actor.userId, now });
        await keeper.putIn(transfer.toOutletId, transfer.lines, document, 'transfer_in');
      } else {
        transfer.reject({ on, by: actor.userId, reason: reason ?? '', now });
        await keeper.putIn(transfer.fromOutletId, transfer.lines, document, 'transfer_in');
        if (transfer.indentId) {
          const indent = await this.transfers.indent(transfer.indentId);
          indent.untransfer(transfer.quantities(), now);
          await indents.update(indent);
        }
      }
      await transfers.update(transfer);
      await desk.record('transfer', decision === 'accept' ? 'accepted' : 'rejected', actor, id, { reason });
    });
  }
}

@QueryHandler(ListIndentsQuery)
export class ListIndentsHandler implements IQueryHandler<ListIndentsQuery> {
  constructor(
    private readonly read: TransferReadRepository,
    private readonly access: AccessControl,
  ) {}

  async execute({ actor, filter }: ListIndentsQuery) {
    await this.access.authorize(actor.userId, { permissions: [PHARMACY_READ] });
    return this.read.listIndents(filter);
  }
}

@QueryHandler(GetIndentQuery)
export class GetIndentHandler implements IQueryHandler<GetIndentQuery> {
  constructor(
    private readonly read: TransferReadRepository,
    private readonly access: AccessControl,
    private readonly clock: Clock,
  ) {}

  async execute({ actor, id }: GetIndentQuery) {
    await this.access.authorize(actor.userId, { permissions: [PHARMACY_READ] });
    const indent = await this.read.getIndent(id, this.clock.now().toISOString().slice(0, 10));
    if (!indent) throw new NotFoundError('outlet_indent');
    return indent;
  }
}

@QueryHandler(ListTransfersQuery)
export class ListTransfersHandler implements IQueryHandler<ListTransfersQuery> {
  constructor(
    private readonly read: TransferReadRepository,
    private readonly access: AccessControl,
  ) {}

  async execute({ actor, filter }: ListTransfersQuery) {
    await this.access.authorize(actor.userId, { permissions: [PHARMACY_READ] });
    return this.read.listTransfers(filter);
  }
}

@QueryHandler(GetTransferQuery)
export class GetTransferHandler implements IQueryHandler<GetTransferQuery> {
  constructor(
    private readonly read: TransferReadRepository,
    private readonly access: AccessControl,
  ) {}

  async execute({ actor, id }: GetTransferQuery) {
    await this.access.authorize(actor.userId, { permissions: [PHARMACY_READ] });
    const transfer = await this.read.getTransfer(id);
    if (!transfer) throw new NotFoundError('transfer');
    return transfer;
  }
}

export const TRANSFER_HANDLERS = [
  PharmacyKeeper,
  TransferDesk,
  RaiseIndentHandler,
  EditIndentHandler,
  EndIndentHandler,
  SendTransferHandler,
  DecideTransferHandler,
  ListIndentsHandler,
  GetIndentHandler,
  ListTransfersHandler,
  GetTransferHandler,
];
