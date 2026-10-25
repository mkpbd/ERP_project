import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DbContext } from '../../../../database/drizzle-transaction-manager.js';
import { ConflictError } from '../../../../shared/domain/errors.js';
import { uniqueViolationConstraint } from '../../../../shared/infrastructure/persistence/pg-errors.js';
import { UserRepository } from '../../domain/repositories.js';
import { User } from '../../domain/user.js';
import { users } from './identity.schema.js';

type UserRow = typeof users.$inferSelect;

const toDomain = (row: UserRow): User => User.restore({ ...row });

@Injectable()
export class DrizzleUserRepository extends UserRepository {
  constructor(private readonly context: DbContext) {
    super();
  }

  async findById(id: string): Promise<User | null> {
    const [row] = await this.context.db.select().from(users).where(eq(users.id, id)).limit(1);
    return row ? toDomain(row) : null;
  }

  async findByIdForUpdate(id: string): Promise<User | null> {
    const [row] = await this.context.db.select().from(users).where(eq(users.id, id)).limit(1).for('update');
    return row ? toDomain(row) : null;
  }

  async findByEmail(email: string): Promise<User | null> {
    const [row] = await this.context.db.select().from(users).where(eq(users.email, email)).limit(1);
    return row ? toDomain(row) : null;
  }

  async findByUsername(username: string): Promise<User | null> {
    const [row] = await this.context.db.select().from(users).where(eq(users.username, username)).limit(1);
    return row ? toDomain(row) : null;
  }

  async insert(user: User): Promise<void> {
    try {
      await this.context.db.insert(users).values({ ...user.toSnapshot() });
    } catch (error) {
      const constraint = uniqueViolationConstraint(error);
      if (constraint === 'users_email_uq')
        throw new ConflictError('email_taken', 'A user with this email already exists');
      if (constraint === 'users_username_uq') throw new ConflictError('username_taken', 'Username is already taken');
      throw error;
    }
  }

  async update(user: User): Promise<void> {
    const { id, version, createdAt: _createdAt, ...fields } = user.toSnapshot();
    const updated = await this.context.db
      .update(users)
      .set({ ...fields, version: version + 1 })
      .where(and(eq(users.id, id), eq(users.version, version)))
      .returning({ id: users.id });
    if (updated.length === 0) {
      throw new ConflictError('concurrent_modification', 'The user was modified concurrently; retry the request');
    }
    user.markPersisted();
  }
}
