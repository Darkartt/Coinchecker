import 'reflect-metadata';
import {
  Controller,
  Get,
  Post,
  Delete,
  Patch,
  Body,
  Param,
  Query,
  Req,
  Inject,
  Module,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import {
  scanSchema,
  watchSchema,
  NETWORKS,
  compareReports,
  RULES_VERSION,
  type Json,
} from '@coinchecker/shared';
import { Database } from './database.js';
import { Providers } from './providers.js';
import { ScanService, Monitor } from './scan-service.js';
import { settings } from './config.js';

export type AuthRequest = Request & { deviceId: string };
export function validate<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new BadRequestException(result.error.issues.map((i) => i.message).join(' '));
  return result.data;
}
const uuid = (value: string) => validate(z.string().uuid(), value);

@Controller('api/v1')
export class ApiController {
  constructor(
    @Inject(Database) readonly db: Database,
    @Inject(ScanService) readonly scans: ScanService,
    @Inject(Providers) readonly providers: Providers,
  ) {}
  @Post('devices') createDevice() {
    return this.db.createDevice();
  }
  @Delete('device') async deleteDevice(@Req() req: AuthRequest) {
    await this.db.deleteDevice(req.deviceId);
    return { deleted: true };
  }
  @Get('capabilities') capabilities() {
    return {
      rulesVersion: RULES_VERSION,
      networks: Object.values(NETWORKS),
      providers: {
        goplus: { configured: true, credential: !!settings.GOPLUS_ACCESS_TOKEN },
        honeypot: {
          configured:
            settings.NODE_ENV !== 'production' ||
            settings.HONEYPOT_PRODUCTION_PERMISSION === 'true',
          credential: !!settings.HONEYPOT_API_KEY,
        },
        dexscreener: { configured: true },
        etherscan: { configured: !!settings.ETHERSCAN_API_KEY },
        coingecko: {
          configured: settings.COINGECKO_API_TIER !== 'pro' || !!settings.COINGECKO_API_KEY,
          credential: !!settings.COINGECKO_API_KEY,
        },
        rpc: { configured: true },
      },
      monitorIntervalSeconds: settings.MONITOR_INTERVAL_SECONDS,
    };
  }
  @Post('scans') scan(@Req() req: AuthRequest, @Body() body: unknown) {
    return this.scans.scan(req.deviceId, validate(scanSchema, body));
  }
  @Get('reports/:id') async report(@Req() req: AuthRequest, @Param('id') id: string) {
    const report = await this.db.report(req.deviceId, uuid(id));
    if (!report) throw new NotFoundException('Report not found for this installation.');
    return report;
  }
  @Get('reports/:id/evidence') async evidence(@Req() req: AuthRequest, @Param('id') id: string) {
    const report = await this.report(req, id);
    return {
      reportId: report.id,
      rulesVersion: report.rulesVersion,
      chainId: report.chainId,
      address: report.address,
      evidence: report.evidence,
      sources: report.sources,
    };
  }
  @Get('history') history(@Req() req: AuthRequest, @Query() query: unknown) {
    const input = validate(scanSchema, query);
    return this.db.history(req.deviceId, input.chainId, input.address, input.pairAddress);
  }
  @Get('compare') async compare(
    @Req() req: AuthRequest,
    @Query('previous') previous: string,
    @Query('current') current: string,
  ) {
    const a = await this.report(req, previous),
      b = await this.report(req, current);
    try {
      return { previous: a.id, current: b.id, changes: compareReports(a, b) };
    } catch {
      throw new BadRequestException('Choose reports for the same network, token, and pool.');
    }
  }
  @Get('watches') watches(@Req() req: AuthRequest) {
    return this.db.watches(req.deviceId);
  }
  @Post('watches') async watch(@Req() req: AuthRequest, @Body() body: unknown) {
    const input = validate(watchSchema, body);
    try {
      const id = await this.db.upsertWatch(req.deviceId, input);
      return (await this.db.watches(req.deviceId)).find((w) => w.id === id);
    } catch (e) {
      if (e instanceof Error && e.message.includes('50 tokens'))
        throw new BadRequestException(e.message);
      throw e;
    }
  }
  @Delete('watches/:id') async unwatch(@Req() req: AuthRequest, @Param('id') id: string) {
    if (!(await this.db.deleteWatch(req.deviceId, uuid(id))))
      throw new NotFoundException('Watch not found.');
    return { deleted: true };
  }
  @Get('alerts') alerts(@Req() req: AuthRequest) {
    return this.db.alerts(req.deviceId);
  }
  @Patch('alerts/:id') async markAlert(@Req() req: AuthRequest, @Param('id') id: string) {
    if (!(await this.db.markAlert(req.deviceId, uuid(id))))
      throw new NotFoundException('Alert not found.');
    return { read: true };
  }
  @Post('resolve') async resolve(@Body() body: unknown) {
    const input = validate(
      z.object({ chainId: z.enum(['1', '8453']), pairAddress: scanSchema.shape.address }).strict(),
      body,
    );
    return this.providers.resolvePair(input.chainId, input.pairAddress);
  }
}

@Module({
  controllers: [ApiController],
  providers: [
    { provide: Database, useFactory: () => new Database(settings) },
    {
      provide: Providers,
      useFactory: (db: Database) => new Providers(settings, db),
      inject: [Database],
    },
    {
      provide: ScanService,
      useFactory: (db: Database, p: Providers) => new ScanService(db, p),
      inject: [Database, Providers],
    },
    {
      provide: Monitor,
      useFactory: (db: Database, s: ScanService) => new Monitor(db, s),
      inject: [Database, ScanService],
    },
  ],
})
export class AppModule {}
