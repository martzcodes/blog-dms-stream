import {
  DatabaseMigrationServiceClient,
  DescribeReplicationTasksCommand,
} from '@aws-sdk/client-database-migration-service';

export const getDmsStatus = async ({
  dms,
  ReplicationTaskArn,
}: {
  dms: DatabaseMigrationServiceClient;
  ReplicationTaskArn: string;
}): Promise<string> => {
  const taskDescriptionCmd = new DescribeReplicationTasksCommand({
    Filters: [
      {
        Name: 'replication-task-arn',
        Values: [ReplicationTaskArn],
      },
    ],
    WithoutSettings: true,
  });
  const taskDescription = await dms.send(taskDescriptionCmd);
  const status = `${taskDescription?.ReplicationTasks?.[0].Status}`;
  return status;
};