import { ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { JwtPayload } from './jwt-payload.interface.js';

/**
 * Applied GLOBALLY (see AppModule) so that whenever a request DOES carry a
 * bearer token, its signature is verified and req.user is populated with the
 * trusted payload BEFORE TenantContextInterceptor runs (Guards execute before
 * Interceptors in Nest's request lifecycle — this is the fix for the
 * middleware-based tenant-context race that existed before this pass).
 *
 * A request with NO token is allowed through with req.user left undefined —
 * public routes (login, registration, health) must keep working. A request
 * WITH a token that fails verification (forged/expired/bad signature) is
 * still rejected: presenting a bad token is never silently downgraded to
 * "anonymous", since that would let a forged token probe for behavior
 * differences.
 */
@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  handleRequest<TUser = JwtPayload>(err: unknown, user: TUser | false, info: unknown, context: ExecutionContext): TUser {
    const request = context.switchToHttp().getRequest();
    const hasAuthHeader = typeof request.headers?.authorization === 'string' && request.headers.authorization.length > 0;

    if (!hasAuthHeader) {
      // No token presented at all — proceed unauthenticated.
      return undefined as unknown as TUser;
    }

    if (err || !user) {
      // A token WAS presented but failed verification — reject, don't silently
      // fall back to unauthenticated (that would mask forged/expired tokens).
      throw err instanceof Error ? err : new UnauthorizedException('Invalid or expired token');
    }

    return user;
  }
}
