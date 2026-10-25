import { Global, Module, type DynamicModule } from '@nestjs/common';
import { loadConfig, type AppConfig } from './configuration.js';

export const APP_CONFIG = Symbol('APP_CONFIG');

@Global()
@Module({})
export class ConfigModule {
  /** Pass a config explicitly (tests) or let it be parsed from process.env. */
  static forRoot(config: AppConfig = loadConfig()): DynamicModule {
    return {
      module: ConfigModule,
      providers: [{ provide: APP_CONFIG, useValue: config }],
      exports: [APP_CONFIG],
    };
  }
}
