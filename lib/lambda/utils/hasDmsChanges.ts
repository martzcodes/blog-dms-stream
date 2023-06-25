import { CloudFormationClient, DescribeStacksCommand } from '@aws-sdk/client-cloudformation';
import { getChangeSet } from './getChangeSet';

export const hasDmsChanges = async ({
  cf,
  StackName,
}: {
  cf: CloudFormationClient;
  StackName: string;
}): Promise<boolean> => {
  const describeCommand = new DescribeStacksCommand({ StackName });
  const stacks = await cf.send(describeCommand);
  console.log(JSON.stringify({ stacks }));
  const changes = await getChangeSet({
    cf,
    StackName,
    ChangeSetName: stacks.Stacks?.[0].ChangeSetId || '',
    changes: [],
  });
  const dmsChanges =
    changes.filter((change) => change.ResourceChange?.ResourceType?.startsWith('AWS::DMS')).length !== 0;
  return dmsChanges;
};