import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { TenantContextService } from './tenant-context.service.js';
import type { JwtPayload } from '../auth/jwt-payload.interface.js';

/**
 * SECURITY CORRECTION (Phase-1 foundation review): this replaces the earlier
 * TenantContextMiddleware, which read req.user from middleware — middleware
 * runs BEFORE guards in Nest's request lifecycle, so req.user was not
 * reliably populated yet when tenant context was captured. Interceptors run
 * AFTER guards, so by the time this runs, OptionalJwtAuthGuard (global) has
 * already verified any presented token's signature.
 *
 * Deliberately reads ONLY req.user (guard-verified). It never reads
 * x-tenant-id or any other client-supplied header/query/body value as tenant
 * context — a forged header must never become the authoritative tenant.
 *
 * The AsyncLocalStorage.run() callback synchronously subscribes to
 * next.handle() (rather than merely returning it) so that the ALS context is
 * active for the entire async continuation chain the route handler spawns —
 * including anything awaited deep inside a service/repository call, not just
 * the top-level synchronous frame.
 */
@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  constructor(private readonly tenantContext: TenantContextService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest();
    const user: JwtPayload | undefined = request.user;

    return new Observable((subscriber) => {
      this.tenantContext.run(
        {
          tenantId: user?.tenantId ?? null,
          userId: user?.sub,
          isPlatformSuperAdmin: user?.isPlatformSuperAdmin ?? false,
        },
        () => {
          next.handle().subscribe({
            next: (value) => subscriber.next(value),
            error: (err) => subscriber.error(err),
            complete: () => subscriber.complete(),
          });
        },
      );
    });
  }
}
