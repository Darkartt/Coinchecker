import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { HttpException } from '@nestjs/common';
import helmet from 'helmet';
import { json } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { AppModule, type AuthRequest } from './app.js';
import { Database } from './database.js';
import { Monitor } from './scan-service.js';
import { settings } from './config.js';

export async function bootstrap(port = settings.PORT) {
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log'],
    bodyParser: false,
    abortOnError: false,
  });
  const db = app.get(Database),
    monitor = app.get(Monitor);
  await db.initialize();
  app.use(helmet());
  app.use(json({ limit: '16kb' }));
  const allowed = settings.ALLOWED_ORIGINS.split(',').map((s) => s.trim()),
    ids = settings.EXTENSION_IDS.split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  app.enableCors({
    origin: (origin: string | undefined, done: (error: Error | null, allow: boolean) => void) => {
      const extension = origin?.match(/^chrome-extension:\/\/([a-p]{32})$/);
      const accepted =
        !origin ||
        allowed.includes(origin) ||
        (extension && (settings.NODE_ENV !== 'production' || ids.includes(extension[1]!)));
      done(null, !!accepted);
    },
    methods: ['GET', 'POST', 'DELETE', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    maxAge: 600,
  });
  const express = app.getHttpAdapter().getInstance();
  express.get('/health/live', (_req: Request, res: Response) => res.json({ status: 'ok' }));
  express.get('/health/ready', async (_req: Request, res: Response) => {
    try {
      await db.ready();
      res.json({ status: 'ok', postgres: 'ok', redis: 'ok' });
    } catch {
      res.status(503).json({ status: 'unavailable' });
    }
  });
  app.use('/api/v1', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const window = Math.floor(Date.now() / 60000),
        ip = db.hash(req.ip || req.socket.remoteAddress || 'unknown');
      const rateKey = `rate:ip:${ip}:${window}`,
        count = await db.redis.incr(rateKey);
      if (count === 1) await db.redis.expire(rateKey, 70);
      if (count > 120) {
        res.setHeader('Retry-After', '60');
        res.status(429).json({ message: 'Request limit reached. Try again in a minute.' });
        return;
      }
      if (req.path === '/devices' && req.method === 'POST') {
        const key = `rate:devices:${ip}:${Math.floor(Date.now() / 3600000)}`,
          n = await db.redis.incr(key);
        if (n === 1) await db.redis.expire(key, 3700);
        if (n > 60) {
          res.status(429).json({ message: 'Installation registration limit reached.' });
          return;
        }
        next();
        return;
      }
      if (req.path === '/capabilities' && req.method === 'GET') {
        next();
        return;
      }
      const token = req.headers.authorization?.match(/^Bearer ([\w-]+)$/)?.[1],
        deviceId = token ? await db.authenticate(token) : null;
      if (!deviceId) {
        res
          .status(401)
          .json({ message: 'This installation is not authorized. Reconnect in settings.' });
        return;
      }
      (req as AuthRequest).deviceId = deviceId;
      if (req.method === 'POST') {
        const key = `rate:write:${deviceId}:${window}`,
          n = await db.redis.incr(key);
        if (n === 1) await db.redis.expire(key, 70);
        if (n > 15) {
          res.setHeader('Retry-After', '60');
          res.status(429).json({ message: 'Scan and write limit reached. Try again in a minute.' });
          return;
        }
      }
      next();
    } catch {
      res
        .status(503)
        .json({ message: 'Storage or rate limiting is unavailable. Try again shortly.' });
    }
  });
  app.useGlobalFilters({
    catch(exception: unknown, host) {
      const res = host.switchToHttp().getResponse<Response>();
      if (exception instanceof HttpException) {
        res.status(exception.getStatus()).json(exception.getResponse());
      } else {
        res.status(500).json({ message: 'The request could not be completed.' });
      }
    },
  });
  await app.listen(port, '0.0.0.0');
  monitor.start();
  let closing = false;
  async function shutdown() {
    if (closing) return;
    closing = true;
    monitor.stop();
    await app.close();
    await db.close();
  }
  process.once('SIGTERM', () => void shutdown());
  process.once('SIGINT', () => void shutdown());
  return { app, db, monitor, shutdown };
}
if (process.env.COINCHECKER_TEST_MODE !== '1')
  void bootstrap().catch(() => {
    console.error(
      'Coinchecker startup failed. Check database, Redis, and environment configuration.',
    );
    process.exitCode = 1;
  });
