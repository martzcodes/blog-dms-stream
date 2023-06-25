import { CloudFormationClient } from "@aws-sdk/client-cloudformation";
import {
  DatabaseMigrationServiceClient,
  StartReplicationTaskCommand,
} from "@aws-sdk/client-database-migration-service";
import type {
  CloudFormationCustomResourceEvent,
  CloudFormationCustomResourceFailedResponse,
  CloudFormationCustomResourceSuccessResponse,
} from "aws-lambda";
import { getDmsStatus } from "./utils/getDmsStatus";
import { waitForDmsStatus } from "./utils/waitForDmsStatus";
import { hasDmsChanges } from "./utils/hasDmsChanges";

const dms = new DatabaseMigrationServiceClient({});
const cf = new CloudFormationClient({});

export const handler = async (
  event: CloudFormationCustomResourceEvent
): Promise<
  | CloudFormationCustomResourceSuccessResponse
  | CloudFormationCustomResourceFailedResponse
> => {
  // note Delete shouldn't re-start DMS since the stack is being deleted
  const ReplicationTaskArn = `${process.env.DMS_TASK}`;
  console.log(JSON.stringify({ RequestType: event.RequestType }));
  try {
    switch (event.RequestType) {
      case "Create":
        const startCmd = new StartReplicationTaskCommand({
          ReplicationTaskArn,
          StartReplicationTaskType: "start-replication",
        });
        await dms.send(startCmd);
        await waitForDmsStatus({
          dms,
          ReplicationTaskArn,
          targetStatus: "running",
        });
        return { ...event, PhysicalResourceId: "post-dms", Status: "SUCCESS" };
      case "Update":
        let shouldUnpause = false;
        const dmsChanges = await hasDmsChanges({
          cf,
          StackName: `${process.env.STACK_NAME}`,
        });
        if (dmsChanges) {
          shouldUnpause = true;
        } else {
          const status = await getDmsStatus({ dms, ReplicationTaskArn });
          console.log(`DMS status: ${status}`);
          if (status === "stopped" || status === "ready") {
            shouldUnpause = true;
          }
        }

        if (shouldUnpause) {
          // unpause DMS
          const startCmd = new StartReplicationTaskCommand({
            ReplicationTaskArn,
            StartReplicationTaskType: "resume-processing",
          });
          await dms.send(startCmd);
          await waitForDmsStatus({
            dms,
            ReplicationTaskArn,
            targetStatus: "running",
          });
        }
        return { ...event, PhysicalResourceId: "post-dms", Status: "SUCCESS" };

      default:
        console.error("No op for", event.RequestType);
        return { ...event, PhysicalResourceId: "post-dms", Status: "SUCCESS" };
    }
  } catch (e) {
    console.error(`Failed!`, e);
    return {
      ...event,
      PhysicalResourceId: "post-dms",
      Reason: (e as Error).message,
      Status: "FAILED",
    };
  }
};
