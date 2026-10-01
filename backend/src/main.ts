import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);

  app.use(helmet());

  // Explicit allowlist only — no wildcard, no unrestricted enableCors().
  // Empty ALLOWED_ORIGINS (the default) means NO cross-origin access at all,
  // which fails safe rather than open. Add real frontend origins via env as
  // they become known; never hard-code a production domain that isn't frozen.
  const allowedOrigins = config.get<string[]>('cors.allowedOrigins') ?? [];
  app.enableCors({
    origin: allowedOrigins.length > 0 ? allowedOrigins : false,
    credentials: true,
  });

  // OWASP-aligned input validation: reject unknown fields, coerce types safely,
  // never trust client-supplied data — applies to every Priority module's DTOs.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const port = config.get<number>('port') ?? 3000;
  await app.listen(port);
}
await bootstrap();
