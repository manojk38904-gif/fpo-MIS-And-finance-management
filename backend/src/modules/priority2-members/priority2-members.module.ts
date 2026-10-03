import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FpoRegistrationEntity } from '../priority1-auth-registration/entities/fpo-registration.entity.js';
import { MemberApplicationEntity } from './entities/member-application.entity.js';
import { MemberApplicationService } from './services/member-application.service.js';
import { MemberApplicationController } from './controllers/member-application.controller.js';
@Module({ imports: [TypeOrmModule.forFeature([MemberApplicationEntity, FpoRegistrationEntity])], providers: [MemberApplicationService], controllers: [MemberApplicationController] })
export class Priority2MembersModule {}