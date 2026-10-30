import { Global, Module, type OnModuleInit } from '@nestjs/common';
import { DbContext } from '../../database/drizzle-transaction-manager.js';
import { PatientEngagement } from '../../shared/application/contracts/patient-engagement.js';
import { RecordTypeRegistry } from '../../shared/application/records.js';
import { COMMUNICATION_HANDLERS, CommunicationEngagement } from './application/communication.handlers.js';
import { CommunicationRepository } from './application/communication.ports.js';
import { communicationRecordTypes } from './infrastructure/persistence/communication.record-stores.js';
import { DrizzleCommunicationRepository } from './infrastructure/persistence/drizzle-communication.repository.js';
import { COMMUNICATION_CONTROLLERS } from './presentation/communication.controllers.js';

/**
 * Communication (old Others, step 12c): health tips for patients, notices to staff with their own read marks, and
 * live chat between patients and staff. Global: it publishes PatientEngagement, through which the patient portal
 * shows tips and the patient's chats.
 */
@Global()
@Module({
  controllers: COMMUNICATION_CONTROLLERS,
  providers: [
    ...COMMUNICATION_HANDLERS,
    { provide: CommunicationRepository, useClass: DrizzleCommunicationRepository },
    { provide: PatientEngagement, useClass: CommunicationEngagement },
  ],
  exports: [PatientEngagement],
})
export class CommunicationModule implements OnModuleInit {
  constructor(
    private readonly records: RecordTypeRegistry,
    private readonly context: DbContext,
  ) {}

  onModuleInit(): void {
    for (const type of communicationRecordTypes(this.context)) this.records.register(type);
  }
}
