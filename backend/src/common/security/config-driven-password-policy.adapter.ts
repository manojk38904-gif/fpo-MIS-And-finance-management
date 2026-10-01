import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { PasswordPolicy, PasswordPolicyPort } from './password-policy.port.js';

@Injectable()
export class ConfigDrivenPasswordPolicyAdapter implements PasswordPolicyPort {
  constructor(private readonly config: ConfigService) {}

  async getPolicy(): Promise<PasswordPolicy> {
    return {
      minLength: this.config.get<number>('passwordPolicy.minLength') ?? 8,
      requireLetter: this.config.get<boolean>('passwordPolicy.requireLetter') ?? true,
      requireDigit: this.config.get<boolean>('passwordPolicy.requireDigit') ?? true,
      requireSpecialChar: this.config.get<boolean>('passwordPolicy.requireSpecialChar') ?? false,
    };
  }

  async assertValid(password: string): Promise<void> {
    const policy = await this.getPolicy();
    const problems: string[] = [];
    if (password.length < policy.minLength) problems.push(`at least ${policy.minLength} characters`);
    if (policy.requireLetter && !/[A-Za-z]/.test(password)) problems.push('at least one letter');
    if (policy.requireDigit && !/\d/.test(password)) problems.push('at least one digit');
    if (policy.requireSpecialChar && !/[^A-Za-z0-9]/.test(password)) problems.push('at least one special character');

    if (problems.length > 0) {
      throw new BadRequestException(`Password must contain ${problems.join(', ')}.`);
    }
  }
}
