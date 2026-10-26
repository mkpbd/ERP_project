import { DomainError } from '../../../shared/domain/errors.js';
import { MAX_DOCUMENT_LINES, paisa, taka, validAmount } from './documents.js';

/** What is still owed on a posted receive. */
export interface ReceiveDue {
  readonly supplierId: string;
  readonly number: string;
  readonly total: number;
  readonly paid: number;
}

export interface PaymentAllocation {
  readonly receiveId: string;
  readonly dueBefore: number;
  readonly amount: number;
}

/**
 * Old ProcessSupplierDuePaymentCommand: one payment over one or more receives of one supplier. Each amount is
 * more than zero and not above what is still due on that receive, worked out afresh (never taken from the
 * page). Returns the allocations and the total.
 */
export function allocatePayment(
  supplierId: string,
  lines: readonly { receiveId: string; amount: number }[],
  dues: ReadonlyMap<string, ReceiveDue>,
): { allocations: PaymentAllocation[]; total: number } {
  if (lines.length === 0 || lines.length > MAX_DOCUMENT_LINES) {
    throw new DomainError('invalid_lines', `A payment covers 1 to ${MAX_DOCUMENT_LINES} receives`);
  }
  const seen = new Set<string>();
  const allocations = lines.map((line, index) => {
    const at = `Line ${index + 1}`;
    if (seen.has(line.receiveId)) throw new DomainError('duplicate_line', `${at}: the receive is already paid here`);
    seen.add(line.receiveId);
    validAmount(line.amount, at);
    if (line.amount <= 0) throw new DomainError('invalid_amount', `${at}: pay more than 0`);
    const due = dues.get(line.receiveId);
    if (!due) throw new DomainError('not_payable', `${at}: the receive is not posted`);
    if (due.supplierId !== supplierId) {
      throw new DomainError('not_payable', `${at}: receive ${due.number} is another supplier's`);
    }
    const dueBefore = taka(paisa(due.total) - paisa(due.paid));
    if (paisa(line.amount) > paisa(dueBefore)) {
      throw new DomainError('overpayment', `${at}: only ${dueBefore.toFixed(2)} is due on ${due.number}`);
    }
    return { receiveId: line.receiveId, dueBefore, amount: line.amount };
  });
  return { allocations, total: taka(allocations.reduce((sum, line) => sum + paisa(line.amount), 0)) };
}
