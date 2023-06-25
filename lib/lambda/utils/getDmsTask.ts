import { CloudFormationClient } from '@aws-sdk/client-cloudformation';
import { listStackResources } from './listStackResources';

export const getDmsTask = async ({ cf, StackName }: {
  cf: CloudFormationClient;
  StackName: string;
}): Promise<string> => {
  const resources = await listStackResources({ cf, StackName, resources: [] });
  const dmsTask = resources.filter((res) => res.ResourceType === "AWS::DMS::ReplicationTask")[0].PhysicalResourceId;
  return `${dmsTask}`;
};