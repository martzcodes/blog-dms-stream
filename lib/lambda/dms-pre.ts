import { CloudFormationClient } from '@aws-sdk/client-cloudformation';
import { DatabaseMigrationServiceClient, StopReplicationTaskCommand } from '@aws-sdk/client-database-migration-service';
import type {
  CloudFormationCustomResourceEvent,
  CloudFormationCustomResourceFailedResponse,
  CloudFormationCustomResourceSuccessResponse,
} from 'aws-lambda';
import { getDmsTask } from './utils/getDmsTask';
import { hasDmsChanges } from './utils/hasDmsChanges';
import { getDmsStatus } from './utils/getDmsStatus';
import { waitForDmsStatus } from './utils/waitForDmsStatus';

const dms = new DatabaseMigrationServiceClient({});
const cf = new CloudFormationClient({});
let ReplicationTaskArn: string;

export const handler = async (
  event: CloudFormationCustomResourceEvent,
): Promise<CloudFormationCustomResourceSuccessResponse | CloudFormationCustomResourceFailedResponse> => {
  try {
    const StackName = `${process.env.STACK_NAME}`;
    if (!ReplicationTaskArn) {
      ReplicationTaskArn = await getDmsTask({ cf, StackName });
    }
    const status = await getDmsStatus({ dms, ReplicationTaskArn });
    if (status === 'running') {
      if (event.RequestType === 'Delete' || await hasDmsChanges({ cf, StackName })) {
        // pause task
        const stopCmd = new StopReplicationTaskCommand({
          ReplicationTaskArn,
        });
        await dms.send(stopCmd);
        // wait for task to be fully paused
        await waitForDmsStatus({ dms, ReplicationTaskArn, targetStatus: 'stopped' });
      }
    }
    return { ...event, PhysicalResourceId: 'pre-dms', Status: 'SUCCESS' };
  } catch (e) {
    console.error(`Failed!`, e);
    return { ...event, PhysicalResourceId: 'pre-dms', Reason: (e as Error).message, Status: 'FAILED' };
  }
};