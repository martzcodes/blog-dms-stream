import { Change, CloudFormationClient, DescribeChangeSetCommand } from "@aws-sdk/client-cloudformation";

export const getChangeSet = async ({
    cf,
    changes = [],
    ChangeSetName,
    NextToken,
    StackName,
  }: {
    cf: CloudFormationClient;
    StackName: string;
    ChangeSetName: string;
    changes: Change[];
    NextToken?: string;
  }): Promise<Change[]> => {
    const changeSetCommand = new DescribeChangeSetCommand({
      StackName,
      ChangeSetName,
      NextToken,
    });
    const changeSet = await cf.send(changeSetCommand);
    const nextChanges = [...changes, ...(changeSet.Changes || [])];
    if (changeSet.NextToken) {
      return getChangeSet({ cf, StackName, ChangeSetName, changes: nextChanges, NextToken: changeSet.NextToken});
    } else {
      return nextChanges;
    }
  };