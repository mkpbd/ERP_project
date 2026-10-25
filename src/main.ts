import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { configureApp } from './bootstrap/configure-app.js';
import { loadConfig } from './config/configuration.js';

async function bootstrap(): Promise<void> {
  // Local convenience only; deployed environments inject variables directly.
  // Existing environment variables always take precedence over the file.
  try {
    process.loadEnvFile();
  } catch {
    // No .env file present.
  }
  // Fails fast with a readable list of invalid variables (values are never printed).
  const config = loadConfig();
  const app = await NestFactory.create<NestExpressApplication>(AppModule.register(config), {
    bufferLogs: true,
    bodyParser: false,
  });
  configureApp(app, config);
  await app.listen(config.port);
}

await bootstrap();
