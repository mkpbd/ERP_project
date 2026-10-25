/**
 * Development-only sample data; refuses to run with NODE_ENV=production.
 * Creates a super-admin, two roles and three users with well-known passwords.
 * Safe to re-run: existing records are left as they are.
 */
import 'reflect-metadata';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { NestFactory } from '@nestjs/core';
import { eq } from 'drizzle-orm';
import { AppModule } from '../app.module.js';
import { loadConfig } from '../config/configuration.js';
import { DbContext } from '../database/drizzle-transaction-manager.js';
import {
  AssignUserRoleCommand,
  CreateRoleCommand,
} from '../modules/access-control/application/commands/access-control.commands.js';
import { ListRolesQuery } from '../modules/access-control/application/queries/access-control.queries.js';
import {
  BootstrapAdministratorCommand,
  CreateUserCommand,
} from '../modules/identity/application/commands/user.commands.js';
import { users } from '../modules/identity/infrastructure/persistence/identity.schema.js';
import type { Actor } from '../shared/application/actor.js';
import { ConflictError } from '../shared/domain/errors.js';
import { loadLocalEnv } from './load-env.js';

loadLocalEnv();
const config = loadConfig();
if (config.isProduction) {
  console.error('Refusing to seed development data in production');
  process.exit(1);
}

const ADMIN = { email: 'admin@example.com', password: 'Dev-Root-Passw0rd!' };
const USER_PASSWORD = 'DevUser-Passw0rd!';
const ROLES = [
  {
    name: 'auditor',
    description: 'Read-only access to users and the audit log',
    permissions: ['users:read', 'audit:read'],
  },
  {
    name: 'user-manager',
    description: 'Manages user accounts',
    permissions: ['users:read', 'users:create', 'users:update', 'users:deactivate', 'sessions:revoke'],
  },
];
const USERS = [
  { email: 'auditor@example.com', displayName: 'Ada Auditor', role: 'auditor' },
  { email: 'manager@example.com', displayName: 'Uma Manager', role: 'user-manager' },
  { email: 'member@example.com', displayName: 'Max Member', role: null },
];

const app = await NestFactory.createApplicationContext(AppModule.register(config), { logger: ['error', 'warn'] });
try {
  await app.init();
  const commands = app.get(CommandBus);
  const queries = app.get(QueryBus);
  const db = app.get(DbContext).db;
  const userId = async (email: string): Promise<string | undefined> =>
    (await db.select({ id: users.id }).from(users).where(eq(users.email, email)))[0]?.id;

  await commands.execute(new BootstrapAdministratorCommand(ADMIN.email, ADMIN.password, 'Dev Admin'));
  const adminId = await userId(ADMIN.email);
  if (!adminId) throw new Error(`${ADMIN.email} is missing; another super-admin may already exist`);
  // Scripts act as the seeded admin; no HTTP session stands behind this actor.
  const admin: Actor = { userId: adminId, sessionId: '00000000-0000-0000-0000-000000000000' };

  for (const role of ROLES) {
    await ignoreConflict(() =>
      commands.execute(new CreateRoleCommand(admin, role.name, role.description, role.permissions)),
    );
  }
  const roles = await queries.execute(new ListRolesQuery(admin));

  for (const user of USERS) {
    await ignoreConflict(() =>
      commands.execute(new CreateUserCommand(admin, user.email, USER_PASSWORD, user.displayName, null)),
    );
    const id = await userId(user.email);
    const roleId = roles.find((role) => role.name === user.role)?.id;
    if (id && roleId) await commands.execute(new AssignUserRoleCommand(admin, id, roleId));
  }

  console.log('Development data ready:');
  console.log(`  ${ADMIN.email} / ${ADMIN.password} (super-admin)`);
  for (const user of USERS) console.log(`  ${user.email} / ${USER_PASSWORD} (${user.role ?? 'no role'})`);
} finally {
  await app.close();
}

async function ignoreConflict(work: () => Promise<unknown>): Promise<void> {
  try {
    await work();
  } catch (error) {
    if (!(error instanceof ConflictError)) throw error;
  }
}
