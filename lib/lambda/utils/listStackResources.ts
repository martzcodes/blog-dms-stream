import { CloudFormationClient, ListStackResourcesCommand, StackResourceSummary } from '@aws-sdk/client-cloudformation';

export const listStackResources = async ({
  cf,
  resources = [],
  NextToken,
  StackName,
}: {
  cf: CloudFormationClient;
  StackName: string;
  resources: StackResourceSummary[];
  NextToken?: string;
}): Promise<StackResourceSummary[]> => {
  const listResourcesCommand = new ListStackResourcesCommand({
    StackName,
    NextToken,
  });
  const resourceSummaries = await cf.send(listResourcesCommand);
  const nextResources = [...resources, ...(resourceSummaries.StackResourceSummaries || [])];
  if (resourceSummaries.NextToken) {
    return listStackResources({ cf, StackName, resources: nextResources, NextToken: resourceSummaries.NextToken });
  } else {
    return nextResources;
  }
};