import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { JwtPayload } from '../../../common/auth/jwt-payload.interface.js';
import { TenantRbacService } from '../services/tenant-rbac.service.js';

export const TENANT_PERMISSION_KEY = 'tenantPermission';
export const RequireTenantPermission = (code: string) => SetMetadata(TENANT_PERMISSION_KEY, code);

const GOVERNED_SCREEN_PERMISSION: Record<string, string> = {
  'SET-05': 'SETTINGS.CONFIGURE',
  'SET-09': 'SETTINGS.USER_MANAGE',
  'SET-11': 'SETTINGS.APPROVAL_CONFIGURE',
  'SET-12': 'SETTINGS.CONFIGURE',
  'SET-13': 'SETTINGS.CREDIT_CONFIGURE',
  'SET-14': 'SETTINGS.CREDIT_CONFIGURE',
  'SET-16': 'SETTINGS.PURCHASE_CONFIGURE',
  'SET-17': 'SETTINGS.INVENTORY_CONFIGURE',
  'SET-21': 'SETTINGS.COMPLIANCE_MANAGE',
};

@Injectable()
export class TenantPermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly rbac: TenantRbacService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    let required = this.reflector.getAllAndOverride<string>(TENANT_PERMISSION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) return true;

    const req = context.switchToHttp().getRequest<Request & { user?: JwtPayload; params?: Record<string,string> }>();
    const user = req.user;
    if (!user || user.isPlatformSuperAdmin || !user.tenantId) {
      throw new ForbiddenException('Tenant user access is required.');
    }

    if (required === 'DYNAMIC_SETTINGS_SCREEN') {
      let screenId = String(req.params?.screenId ?? '').toUpperCase();
      if (!screenId && req.params?.id) {
        screenId = (await this.rbac.governedSubmissionScreen(user.tenantId, String(req.params.id))) ?? '';
      }
      required = GOVERNED_SCREEN_PERMISSION[screenId] ?? '';
      if (!required) throw new ForbiddenException('This settings screen is not available through the governed-settings endpoint.');
    }

    await this.rbac.assertPermission(user.tenantId, user.sub, user.roleId, required);
    return true;
  }
}
