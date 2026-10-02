import { ForbiddenException, Injectable } from '@nestjs/common';
import { KnownTenantTransactionRunner } from '../../../common/tenant-context/known-tenant-transaction-runner.js';
import { UserAccountEntity } from '../../priority1-auth-registration/entities/user-account.entity.js';
import { ApprovalStatus } from '../entities/approval-status.enum.js';
import { RoleEntity } from '../entities/role.entity.js';
import { GovernedSettingEntity } from '../entities/governed-setting.entity.js';

export const SETTINGS_PERMISSION_CODES = [
  'SETTINGS.CONFIGURE',
  'SETTINGS.USER_MANAGE',
  'SETTINGS.ROLE_MANAGE',
  'SETTINGS.APPROVAL_CONFIGURE',
  'SETTINGS.CREDIT_CONFIGURE',
  'SETTINGS.VIEW',
  'SETTINGS.PURCHASE_CONFIGURE',
  'SETTINGS.INVENTORY_CONFIGURE',
  'SETTINGS.COMPLIANCE_MANAGE',
  'SETTINGS.DATA_EXPORT',
] as const;

const FULL_SETTINGS_ACTIONS = [
  'VIEW','CREATE','EDIT','VERIFY','APPROVE','REJECT','DOWNLOAD','EXPORT','PRINT',
  'CONFIGURE','ISSUE','RETURN','ADJUST','TRANSFER','RECONCILE',
];

/**
 * Priority #13 authoritative tenant-RBAC service.
 *
 * Default FPO-Super-Admin is a system-seeded, read-only base role as frozen
 * by SET-08. It is seeded only inside the tenant's RLS context and assigned
 * to the Initial FPO Admin created by Priority #1. Custom role changes remain
 * maker-checker governed by RoleService.
 */
@Injectable()
export class TenantRbacService {
  constructor(private readonly knownTenantTx: KnownTenantTransactionRunner) {}

  async ensureDefaultRoleForTenant(tenantId: string): Promise<RoleEntity> {
    return this.knownTenantTx.run(tenantId, async (manager) => {
      const users = manager.getRepository(UserAccountEntity);
      const initialAdmin = await users.findOne({ where: { tenantId, isInitialFpoAdmin: true } });
      if (!initialAdmin) throw new ForbiddenException('Initial FPO Admin is not available for tenant RBAC bootstrap.');

      const roles = manager.getRepository(RoleEntity);
      let role = await roles.findOne({
        where: { tenantId, roleName: 'FPO-Super-Admin', isDefaultRole: true, status: ApprovalStatus.ACTIVE },
      });
      if (!role) {
        const permissions: Record<string, string[]> = {
          SETTINGS: [...FULL_SETTINGS_ACTIONS],
        };
        for (const code of SETTINGS_PERMISSION_CODES) {
          if (code !== 'SETTINGS.CONFIGURE' && code !== 'SETTINGS.VIEW') {
            permissions[code] = [...FULL_SETTINGS_ACTIONS];
          }
        }
        role = await roles.save(roles.create({
          tenantId,
          roleName: 'FPO-Super-Admin',
          description: 'System-seeded tenant administration role. Base structure is read-only.',
          permissions,
          scopeDefault: 'ALL_BRANCHES',
          isDefaultRole: true,
          status: ApprovalStatus.ACTIVE,
          makerId: initialAdmin.id,
          checkerId: null,
          submittedAt: null,
          decidedAt: new Date(),
          decisionReason: 'SYSTEM_SEED',
          supersedesId: null,
        }));
      }

      if (initialAdmin.roleId !== role.id || initialAdmin.branchAccessScope !== 'ALL_BRANCHES') {
        initialAdmin.roleId = role.id;
        initialAdmin.branchAccessScope = 'ALL_BRANCHES';
        await users.save(initialAdmin);
      }
      return role;
    });
  }

  async governedSubmissionScreen(tenantId: string, submissionId: string): Promise<string | null> {
    return this.knownTenantTx.run(tenantId, async (manager) => {
      const row = await manager.getRepository(GovernedSettingEntity).findOne({ where: { id: submissionId, tenantId } });
      return row?.screenId ?? null;
    });
  }

  async assertPermission(
    tenantId: string,
    userId: string,
    tokenRoleId: string | null | undefined,
    requiredCode: string,
  ): Promise<void> {
    let roleId = tokenRoleId ?? null;

    if (!roleId) {
      const user = await this.knownTenantTx.run(tenantId, (manager) =>
        manager.getRepository(UserAccountEntity).findOne({ where: { id: userId, tenantId } }),
      );
      if (user?.isInitialFpoAdmin) {
        const seeded = await this.ensureDefaultRoleForTenant(tenantId);
        roleId = seeded.id;
      }
    }

    if (!roleId) throw new ForbiddenException('Your account has no active tenant role assignment.');

    const role = await this.knownTenantTx.run(tenantId, (manager) =>
      manager.getRepository(RoleEntity).findOne({ where: { id: roleId!, tenantId } }),
    );
    // SUPERSEDED is intentionally accepted for an already-issued token:
    // SET-08 freezes permission changes to take effect on next login/refresh,
    // not retroactively in the middle of an existing session.
    if (!role || ![ApprovalStatus.ACTIVE, ApprovalStatus.SUPERSEDED].includes(role.status)) {
      throw new ForbiddenException('Your role is not available for this session.');
    }

    if (!hasPermission(role.permissions, requiredCode)) {
      throw new ForbiddenException('You do not have permission to perform this settings action.');
    }
  }
}

function hasPermission(matrix: Record<string, string[]>, code: string): boolean {
  const parts = code.split('.');
  if (parts.length === 2 && parts[0] === 'SETTINGS' && ['VIEW','CONFIGURE'].includes(parts[1])) {
    return (matrix.SETTINGS ?? []).includes(parts[1]);
  }
  const actions = matrix[code] ?? [];
  return actions.some((a) => ['VIEW','CREATE','EDIT','VERIFY','APPROVE','REJECT','DOWNLOAD','EXPORT','PRINT','CONFIGURE','ISSUE','RETURN','ADJUST','TRANSFER','RECONCILE'].includes(a));
}
