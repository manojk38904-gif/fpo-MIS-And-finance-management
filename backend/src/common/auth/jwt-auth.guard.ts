import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Mandatory authentication — use this (via @UseGuards) on every route that
 * must only ever be reached by a verified identity. Rejects with 401 when no
 * token, an expired token, or a bad signature is presented.
 *
 * Not applied globally: Priority #1's public routes (login, registration,
 * OTP verification) must remain reachable without a token. Apply this guard
 * explicitly, route-by-route, once those controllers exist.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
