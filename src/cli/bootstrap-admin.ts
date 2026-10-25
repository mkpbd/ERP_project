/**
 * Idempotent administrator bootstrap for any environment:
 *
 *   BOOTSTRAP_ADMIN_EMAIL=... BOOTSTRAP_ADMIN_PASSWORD=... npm run admin:bootstrap
 *
 * Does nothing if an active super-admin already exists. If the email belongs
 * to an existing account, that account is promoted and its password is kept.
 * Remove the BOOTSTRAP_* variables from the environment afterwards.
 */
import 'reflect-metadata';
import { CommandBus } from '@nestjs/cqrs';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module.js';
import { loadConfig } from '../config/configuration.js';
import { BootstrapAdministratorCommand } from '../modules/identity/application/commands/user.commands.js';
import { loadLocalEnv } from './load-env.js';

loadLocalEnv();
const email = process.env.BOOTSTRAP_ADMIN_EMAIL;
const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
const displayName = process.env.BOOTSTRAP_ADMIN_DISPLAY_NAME || 'Administrator';
if (!email || !password) {
  console.error('BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD must be set');
  process.exit(1);
}

const app = await NestFactory.createApplicationContext(AppModule.register(loadConfig()), { logger: ['error', 'warn'] });
try {
  // init() runs bootstrap hooks, which synchronize the permission catalog and the super-admin role.
  await app.init();
  const result = await app.get(CommandBus).execute(new BootstrapAdministratorCommand(email, password, displayName));
  console.log(
    result.created
      ? `Super-admin provisioned (user ${result.userId})`
      : 'An active super-admin already exists; nothing changed',
  );
} finally {
  await app.close();
}
