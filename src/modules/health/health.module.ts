import { Controller, Get, HttpCode, HttpStatus, Inject, Injectable, Module, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Query, QueryBus, QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import { ApiOkResponse, ApiOperation, ApiServiceUnavailableResponse, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type pg from 'pg';
import { z } from 'zod';
import { PG_POOL } from '../../database/database.provider.js';
import { Public } from '../../shared/presentation/auth.decorators.js';
import { responseDto } from '../../shared/presentation/zod/common.schemas.js';

// --- application -------------------------------------------------------------

export abstract class DependencyProbe {
  abstract readonly name: string;
  abstract check(): Promise<boolean>;
}

export interface ReadinessReport {
  status: 'ok' | 'unavailable';
  checks: Record<string, 'up' | 'down'>;
}

export class CheckReadinessQuery extends Query<ReadinessReport> {}

export const DEPENDENCY_PROBES = Symbol('DEPENDENCY_PROBES');

@QueryHandler(CheckReadinessQuery)
export class CheckReadinessHandler implements IQueryHandler<CheckReadinessQuery> {
  constructor(@Inject(DEPENDENCY_PROBES) private readonly probes: DependencyProbe[]) {}

  async execute(): Promise<ReadinessReport> {
    const results = await Promise.all(
      this.probes.map(async (probe) => [probe.name, (await probe.check().catch(() => false)) ? 'up' : 'down'] as const),
    );
    const checks = Object.fromEntries(results);
    return { status: results.every(([, state]) => state === 'up') ? 'ok' : 'unavailable', checks };
  }
}

// --- infrastructure ----------------------------------------------------------

@Injectable()
export class PostgresProbe extends DependencyProbe {
  readonly name = 'database';

  constructor(@Inject(PG_POOL) private readonly pool: pg.Pool) {
    super();
  }

  async check(): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query('select 1');
      return true;
    } finally {
      client.release();
    }
  }
}

// --- presentation ------------------------------------------------------------

class LivenessResponseDto extends responseDto({ status: z.literal('ok') }) {}
class ReadinessResponseDto extends responseDto({
  status: z.enum(['ok', 'unavailable']),
  checks: z.record(z.string(), z.enum(['up', 'down'])),
}) {}

@ApiTags('health')
@Public()
@SkipThrottle()
@Controller({ path: 'health', version: '1' })
export class HealthController {
  constructor(private readonly queryBus: QueryBus) {}

  @Get('live')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Process is up (no dependency checks)' })
  @ApiOkResponse({ type: LivenessResponseDto })
  live(): LivenessResponseDto {
    return { status: 'ok' };
  }

  @Get('ready')
  @ApiOperation({ summary: 'Dependencies reachable; safe to receive traffic' })
  @ApiOkResponse({ type: ReadinessResponseDto })
  @ApiServiceUnavailableResponse({ type: ReadinessResponseDto })
  async ready(@Res({ passthrough: true }) response: Response): Promise<ReadinessReport> {
    const report = await this.queryBus.execute(new CheckReadinessQuery());
    if (report.status !== 'ok') response.status(HttpStatus.SERVICE_UNAVAILABLE);
    return report;
  }
}

@Module({
  controllers: [HealthController],
  providers: [
    CheckReadinessHandler,
    PostgresProbe,
    { provide: DEPENDENCY_PROBES, inject: [PostgresProbe], useFactory: (...probes: DependencyProbe[]) => probes },
  ],
})
export class HealthModule {}
