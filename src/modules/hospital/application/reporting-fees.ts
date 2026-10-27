import { Injectable } from '@nestjs/common';
import { ReportingFees } from '../../../shared/application/contracts/reporting-fees.js';
import { DomainError, NotFoundError } from '../../../shared/domain/errors.js';
import { DiagnosticBillRepository } from '../domain/repositories.js';
import { CONSULTANT_PAYABLE_ROLE } from './opd.messages.js';
import { OpdDesk } from './opd.handlers.js';

/** The reporting doctors' fees on diagnostic tests (credited to consultant_payable). */
export const REPORTING_FEE_ROLE = 'reporting_fee_expense';

/**
 * Old TestWiseReportingFees / TestGroupWiseReportingFees with fnRadiologyReportingFee (worked out for the payment sheet,
 * a paid flag on the bill line): the reporting doctor's fee goes to their ledger when the report is signed, with a
 * voucher, and comes back off if the signature is taken back.
 */
@Injectable()
export class HospitalReportingFees extends ReportingFees {
  constructor(
    private readonly opd: OpdDesk,
    private readonly bills: DiagnosticBillRepository,
  ) {
    super();
  }

  async credit(params: {
    billId: string;
    line: number;
    doctorId: string;
    documentNumber: string;
    on: string;
    by: string;
  }) {
    const doctor = (await this.opd.bills.doctors([params.doctorId])).get(params.doctorId);
    if (!doctor) throw new NotFoundError('doctor');
    if (!doctor.isActive) throw new DomainError('not_bookable', `${doctor.name} is not active`);
    const fee = await this.bills.reportingFee(params.billId, params.line);
    if (!fee) throw new NotFoundError('diagnostic_bill');
    const amount =
      fee.amount !== null
        ? Math.min(fee.amount, fee.rate)
        : Math.round(fee.rate * 100 * ((fee.percent ?? 0) / 100)) / 100;
    if (amount > 0)
      await this.book(params.billId, params.doctorId, params.documentNumber, amount, params.on, params.by);
    return amount;
  }

  async reverse(params: {
    billId: string;
    doctorId: string;
    documentNumber: string;
    amount: number;
    on: string;
    by: string;
  }) {
    if (params.amount > 0) {
      await this.book(params.billId, params.doctorId, params.documentNumber, -params.amount, params.on, params.by);
    }
  }

  private async book(billId: string, doctorId: string, documentNumber: string, amount: number, on: string, by: string) {
    const narration = `Reporting fee ${documentNumber}${amount < 0 ? ' taken back' : ''}`;
    const value = Math.abs(amount);
    await this.opd.posting.post({
      journal: 'JV',
      voucherDate: on,
      narration,
      source: { module: 'hospital', reference: billId },
      lines:
        amount > 0
          ? [
              { account: { role: REPORTING_FEE_ROLE }, debit: value, credit: 0, narration },
              { account: { role: CONSULTANT_PAYABLE_ROLE }, debit: 0, credit: value, narration },
            ]
          : [
              { account: { role: CONSULTANT_PAYABLE_ROLE }, debit: value, credit: 0, narration },
              { account: { role: REPORTING_FEE_ROLE }, debit: 0, credit: value, narration },
            ],
      postedBy: by,
    });
    await this.opd.bills.addLedger([
      {
        doctorId,
        entryOn: on,
        kind: amount > 0 ? 'share' : 'reversal',
        billId: null,
        diagnosticBillId: billId,
        documentNumber,
        amount,
      },
    ]);
  }
}
