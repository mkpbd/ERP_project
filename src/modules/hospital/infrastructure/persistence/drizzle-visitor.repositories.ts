import { Injectable } from '@nestjs/common';
import { and, count, desc, eq, isNull } from 'drizzle-orm';
import { UserDirectory } from '../../../../shared/application/contracts/user-directory.js';
import { DbContext } from '../../../../database/drizzle-transaction-manager.js';
import {
  VisitorPassReadRepository,
  type VisitorPassCard,
  type VisitorPassView,
} from '../../application/visitor.messages.js';
import { VisitorPassRepository } from '../../domain/repositories.js';
import { VisitorPass } from '../../domain/visitor-pass.js';
import { admissions, beds, bedStays, patients, visitorPasses, wards } from './hospital.schema.js';

@Injectable()
export class DrizzleVisitorPassRepository extends VisitorPassRepository {
  constructor(private readonly context: DbContext) {
    super();
  }

  async activeCount(admissionId: string): Promise<number> {
    const [row] = await this.context.db
      .select({ n: count() })
      .from(visitorPasses)
      .where(and(eq(visitorPasses.admissionId, admissionId), eq(visitorPasses.status, 'active')));
    return row?.n ?? 0;
  }

  async insert(pass: VisitorPass): Promise<void> {
    await this.context.db.insert(visitorPasses).values(pass.toSnapshot());
  }

  async findForUpdate(id: string): Promise<VisitorPass | null> {
    const [row] = await this.context.db.select().from(visitorPasses).where(eq(visitorPasses.id, id)).for('update');
    return row ? VisitorPass.restore(row) : null;
  }

  async update(pass: VisitorPass): Promise<void> {
    const { id, ...row } = pass.toSnapshot();
    await this.context.db.update(visitorPasses).set(row).where(eq(visitorPasses.id, id));
  }
}

@Injectable()
export class DrizzleVisitorPassReadRepository extends VisitorPassReadRepository {
  constructor(
    private readonly context: DbContext,
    private readonly users: UserDirectory,
  ) {
    super();
  }

  private query() {
    return this.context.db
      .select({
        pass: visitorPasses,
        admissionStatus: admissions.status,
        admissionNumber: admissions.number,
        patientName: patients.fullName,
        uhid: patients.uhid,
        bedCode: beds.code,
        wardName: wards.name,
      })
      .from(visitorPasses)
      .innerJoin(admissions, eq(admissions.id, visitorPasses.admissionId))
      .innerJoin(patients, eq(patients.id, admissions.patientId))
      .leftJoin(bedStays, and(eq(bedStays.admissionId, admissions.id), isNull(bedStays.toAt)))
      .leftJoin(beds, eq(beds.id, bedStays.bedId))
      .leftJoin(wards, eq(wards.id, beds.wardId));
  }

  private async views(rows: Awaited<ReturnType<DrizzleVisitorPassReadRepository['query']>>) {
    const ids = [...new Set(rows.flatMap(({ pass }) => [pass.issuedBy, pass.returnedBy].filter((id) => id !== null)))];
    const names = new Map((ids.length ? await this.users.findSummaries(ids) : []).map((u) => [u.id, u.displayName]));
    return rows.map(({ pass, admissionStatus, ...rest }) => {
      const { issuedBy, returnedBy, ...fields } = pass;
      return {
        ...rest,
        ...fields,
        issuedByName: issuedBy ? (names.get(issuedBy) ?? null) : null,
        returnedByName: returnedBy ? (names.get(returnedBy) ?? null) : null,
        valid: pass.status === 'active' && admissionStatus === 'admitted',
      };
    });
  }

  async list(admissionId: string): Promise<VisitorPassView[]> {
    const rows = await this.query()
      .where(eq(visitorPasses.admissionId, admissionId))
      .orderBy(desc(visitorPasses.issuedAt));
    return (await this.views(rows)).map(
      ({ admissionNumber: _a, patientName: _p, uhid: _u, bedCode: _b, wardName: _w, ...view }) => view,
    );
  }

  async card(id: string): Promise<VisitorPassCard | null> {
    const [view] = await this.views(await this.query().where(eq(visitorPasses.id, id)));
    return view ?? null;
  }
}
