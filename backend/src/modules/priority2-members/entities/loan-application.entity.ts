import { Column, Entity, Index } from 'typeorm';
import { TenantScopedEntity } from '../../../common/entities/tenant-scoped.entity.js';

export enum LoanApplicationStatus { SUBMITTED='SUBMITTED', UNDER_REVIEW='UNDER_REVIEW', FIELD_VISIT_COMPLETED='FIELD_VISIT_COMPLETED', SANCTIONED='SANCTIONED', AGREEMENT_EXECUTED='AGREEMENT_EXECUTED', DISBURSED='DISBURSED', REJECTED='REJECTED' }

@Entity('loan_application')
@Index(['tenantId','loanApplicationNumber'],{unique:true})
export class LoanApplicationEntity extends TenantScopedEntity {
 @Column({type:'varchar',length:40,name:'loan_application_number'}) loanApplicationNumber!:string;
 @Column({type:'uuid',name:'member_application_id'}) memberApplicationId!:string;
 @Column({type:'varchar',length:32,name:'member_application_number'}) memberApplicationNumber!:string;
 @Column({type:'varchar',length:255,name:'full_name'}) fullName!:string; @Column({type:'varchar',length:10}) mobile!:string; @Column({type:'varchar',length:255,nullable:true}) email!:string|null;
 @Column({type:'text'}) address!:string; @Column({type:'varchar',length:128}) village!:string; @Column({type:'varchar',length:128}) district!:string; @Column({type:'varchar',length:128}) state!:string; @Column({type:'varchar',length:6}) pincode!:string;
 @Column({type:'varchar',length:255,nullable:true,name:'father_or_spouse_name'}) fatherOrSpouseName!:string|null; @Column({type:'varchar',length:32,nullable:true,name:'marital_status'}) maritalStatus!:string|null; @Column({type:'varchar',length:128,nullable:true,name:'religion_caste'}) religionCaste!:string|null;
 @Column({type:'varchar',length:128,nullable:true}) occupation!:string|null; @Column({type:'varchar',length:255,nullable:true,name:'business_name'}) businessName!:string|null; @Column({type:'text',name:'purpose_of_loan'}) purposeOfLoan!:string;
 @Column({type:'numeric',precision:12,scale:2,name:'requested_amount'}) requestedAmount!:string; @Column({type:'int',name:'requested_term_months'}) requestedTermMonths!:number;
 @Column({type:'varchar',length:255,nullable:true,name:'bank_name'}) bankName!:string|null; @Column({type:'varchar',length:34,nullable:true,name:'bank_account_number'}) bankAccountNumber!:string|null; @Column({type:'varchar',length:11,nullable:true}) ifsc!:string|null;
 @Column({type:'text',nullable:true,name:'existing_credit_details'}) existingCreditDetails!:string|null; @Column({type:'text',nullable:true,name:'collateral_details'}) collateralDetails!:string|null; @Column({type:'varchar',length:255,nullable:true,name:'guarantor_name'}) guarantorName!:string|null; @Column({type:'varchar',length:10,nullable:true,name:'guarantor_mobile'}) guarantorMobile!:string|null;
 @Column({type:'enum',enum:LoanApplicationStatus,default:LoanApplicationStatus.SUBMITTED}) @Index() status!:LoanApplicationStatus;
 @Column({type:'date',nullable:true,name:'field_visit_date'}) fieldVisitDate!:string|null; @Column({type:'varchar',length:255,nullable:true,name:'field_visit_officer'}) fieldVisitOfficer!:string|null; @Column({type:'text',nullable:true,name:'field_visit_observations'}) fieldVisitObservations!:string|null; @Column({type:'varchar',length:16,nullable:true,name:'field_visit_recommendation'}) fieldVisitRecommendation!:string|null;
 @Column({type:'numeric',precision:12,scale:2,nullable:true,name:'sanctioned_amount'}) sanctionedAmount!:string|null; @Column({type:'int',nullable:true,name:'sanctioned_term_months'}) sanctionedTermMonths!:number|null; @Column({type:'numeric',precision:6,scale:2,nullable:true,name:'interest_rate'}) interestRate!:string|null; @Column({type:'numeric',precision:6,scale:2,nullable:true,name:'processing_fee_rate'}) processingFeeRate!:string|null; @Column({type:'varchar',length:16,nullable:true,name:'repayment_frequency'}) repaymentFrequency!:string|null; @Column({type:'date',nullable:true,name:'sanction_date'}) sanctionDate!:string|null;
 @Column({type:'timestamptz',nullable:true,name:'sanction_letter_issued_at'}) sanctionLetterIssuedAt!:Date|null;
 @Column({type:'timestamptz',nullable:true,name:'agreement_executed_at'}) agreementExecutedAt!:Date|null; @Column({type:'timestamptz',nullable:true,name:'disbursed_at'}) disbursedAt!:Date|null; @Column({type:'varchar',length:32,nullable:true,name:'disbursement_mode'}) disbursementMode!:string|null; @Column({type:'varchar',length:100,nullable:true,name:'disbursement_reference'}) disbursementReference!:string|null; @Column({type:'text',nullable:true,name:'decision_note'}) decisionNote!:string|null;
}
