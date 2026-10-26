import { Injectable } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import { DbContext } from '../../../../database/drizzle-transaction-manager.js';
import { NotFoundError } from '../../../../shared/domain/errors.js';
import { foreignKeyViolationConstraint } from '../../../../shared/infrastructure/persistence/pg-errors.js';
import { OutletIndent } from '../../domain/outlet-indent.js';
import { IndentRepository, TransferRepository } from '../../domain/repositories.js';
import { OutletTransfer } from '../../domain/transfer.js';
import { outletIndentLines, outletIndents, outletTransferLines, outletTransfers } from './pharmacy.schema.js';

async function translated<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (error) {
    const reference = foreignKeyViolationConstraint(error);
    if (reference !== null) throw new NotFoundError(reference.includes('product') ? 'product' : 'outlet');
    throw error;
  }
}

@Injectable()
export class DrizzleIndentRepository extends IndentRepository {
  constructor(private readonly context: DbContext) {
    super();
  }

  async findForUpdate(id: string): Promise<OutletIndent | null> {
    const [row] = await this.context.db.select().from(outletIndents).where(eq(outletIndents.id, id)).for('update');
    if (!row) return null;
    const lines = await this.context.db
      .select()
      .from(outletIndentLines)
      .where(eq(outletIndentLines.indentId, id))
      .orderBy(asc(outletIndentLines.position));
    return OutletIndent.restore({
      ...row,
      lines: lines.map(({ indentId: _id, position: _position, ...line }) => line),
    });
  }

  async insert(indent: OutletIndent): Promise<void> {
    const { lines, ...row } = indent.toSnapshot();
    await translated(async () => {
      await this.context.db.insert(outletIndents).values(row);
      await this.saveLines(row.id, lines);
    });
  }

  async update(indent: OutletIndent): Promise<void> {
    const { lines, ...row } = indent.toSnapshot();
    await translated(async () => {
      await this.context.db.update(outletIndents).set(row).where(eq(outletIndents.id, row.id));
      await this.context.db.delete(outletIndentLines).where(eq(outletIndentLines.indentId, row.id));
      await this.saveLines(row.id, lines);
    });
  }

  private async saveLines(id: string, lines: ReturnType<OutletIndent['toSnapshot']>['lines']) {
    await this.context.db
      .insert(outletIndentLines)
      .values(lines.map((line, position) => ({ ...line, indentId: id, position })));
  }
}

@Injectable()
export class DrizzleTransferRepository extends TransferRepository {
  constructor(private readonly context: DbContext) {
    super();
  }

  async findForUpdate(id: string): Promise<OutletTransfer | null> {
    const [row] = await this.context.db.select().from(outletTransfers).where(eq(outletTransfers.id, id)).for('update');
    if (!row) return null;
    const lines = await this.context.db
      .select()
      .from(outletTransferLines)
      .where(eq(outletTransferLines.transferId, id))
      .orderBy(asc(outletTransferLines.position));
    return OutletTransfer.restore({
      ...row,
      lines: lines.map(({ transferId: _id, position: _position, ...line }) => line),
    });
  }

  async insert(transfer: OutletTransfer): Promise<void> {
    const { lines, ...row } = transfer.toSnapshot();
    await translated(async () => {
      await this.context.db.insert(outletTransfers).values(row);
      await this.context.db
        .insert(outletTransferLines)
        .values(lines.map((line, position) => ({ ...line, transferId: row.id, position })));
    });
  }

  async update(transfer: OutletTransfer): Promise<void> {
    const { lines: _lines, ...row } = transfer.toSnapshot();
    await this.context.db.update(outletTransfers).set(row).where(eq(outletTransfers.id, row.id));
  }
}
