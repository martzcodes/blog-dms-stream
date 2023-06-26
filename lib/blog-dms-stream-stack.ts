import { Construct } from "constructs";
import {
  IVpc,
  SecurityGroup,
  Vpc,
} from "aws-cdk-lib/aws-ec2";
import {
  CfnReplicationSubnetGroup,
  CfnReplicationInstance,
  CfnReplicationTask,
  CfnEndpoint,
} from "aws-cdk-lib/aws-dms";
import {
  Role,
  ServicePrincipal,
  PolicyStatement,
  Effect,
  ManagedPolicy,
} from "aws-cdk-lib/aws-iam";
import { Stream, StreamMode } from "aws-cdk-lib/aws-kinesis";
import { Runtime, StartingPosition, Tracing } from "aws-cdk-lib/aws-lambda";
import { KinesisEventSource } from "aws-cdk-lib/aws-lambda-event-sources";
import { RetentionDays } from "aws-cdk-lib/aws-logs";
import { Provider } from "aws-cdk-lib/custom-resources";
import { join } from "path";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { Secret } from "aws-cdk-lib/aws-secretsmanager";
import { Duration, StackProps, Stack, CustomResource } from "aws-cdk-lib";

const lambdaProps = {
  runtime: Runtime.NODEJS_18_X,
  memorySize: 1028,
  timeout: Duration.minutes(15),
  logRetention: RetentionDays.ONE_DAY,
};

export interface BlogDmsStreamStackProps extends StackProps {
  dbName: string;
  secretName: string;
  securityGroupIds: string[];
  tableName: string;
  vpc: IVpc;
}

export class BlogDmsStreamStack extends Stack {
  constructor(scope: Construct, id: string, props: BlogDmsStreamStackProps) {
    super(scope, id, props);

    const { dbName, secretName, securityGroupIds, tableName, vpc } = props;

    const secret = Secret.fromSecretNameV2(this, `secret`, secretName);
    const securityGroups = securityGroupIds.map((sgId) =>
      SecurityGroup.fromSecurityGroupId(this, `sg-${sgId}`, sgId)
    );

    const dbStream = new Stream(this, `db-stream`, {
      streamName: `db-stream`,
      streamMode: StreamMode.ON_DEMAND,
    });

    const dmsRole = new Role(this, `dms-role`, {
      roleName: `dms-vpc-role`, // need the name for this one
      assumedBy: new ServicePrincipal("dms.amazonaws.com"),
    });
    dmsRole.addManagedPolicy(
      ManagedPolicy.fromManagedPolicyArn(this, `AmazonDMSVPCManagementRole`, `arn:aws:iam::aws:policy/service-role/AmazonDMSVPCManagementRole`)
    );

    const dmsSubnet = new CfnReplicationSubnetGroup(this, `dms-subnet`, {
      replicationSubnetGroupDescription: "DMS Subnet",
      subnetIds: vpc.selectSubnets({
        onePerAz: true,
      }).subnetIds,
    });
    dmsSubnet.node.addDependency(dmsRole);

    const dmsRep = new CfnReplicationInstance(this, `dms-replication`, {
      replicationInstanceClass: "dms.t2.micro",
      multiAz: false,
      publiclyAccessible: false,
      replicationSubnetGroupIdentifier: dmsSubnet.ref,
      vpcSecurityGroupIds: securityGroups.map(
        (sg) => sg.securityGroupId
      ),
    });

    const dmsSecretRole = new Role(this, `dms-secret-role`, {
      assumedBy: new ServicePrincipal(
        `dms.${Stack.of(this).region}.amazonaws.com`
      ),
    });
    secret.grantRead(dmsSecretRole);

    const source = new CfnEndpoint(this, `dms-source-endpoint`, {
      endpointType: "source",
      engineName: "aurora",
      mySqlSettings: {
        secretsManagerAccessRoleArn: dmsSecretRole.roleArn,
        secretsManagerSecretId: secret.secretName,
      },
    });

    const streamWriterRole = new Role(this, `dms-stream-role`, {
      assumedBy: new ServicePrincipal(
        `dms.${Stack.of(this).region}.amazonaws.com`
      ),
    });

    streamWriterRole.addToPolicy(
      new PolicyStatement({
        resources: [dbStream.streamArn],
        actions: [
          "kinesis:DescribeStream",
          "kinesis:PutRecord",
          "kinesis:PutRecords",
        ],
      })
    );

    const target = new CfnEndpoint(this, `dms-target-endpoint`, {
      endpointType: "target",
      engineName: "kinesis",
      kinesisSettings: {
        messageFormat: "JSON",
        streamArn: dbStream.streamArn,
        serviceAccessRoleArn: streamWriterRole.roleArn,
      },
    });

    const dmsTableMappings = {
      rules: [
        {
          "rule-type": "selection",
          "rule-id": "1",
          "rule-name": "1",
          "object-locator": {
            "schema-name": dbName,
            "table-name": "%",
            "table-type": "table",
          },
          "rule-action": "include",
          filters: [],
        },
      ],
    };
    const task = new CfnReplicationTask(this, `dms-stream-rep`, {
      replicationInstanceArn: dmsRep.ref,
      migrationType: "cdc",
      sourceEndpointArn: source.ref,
      targetEndpointArn: target.ref,
      tableMappings: JSON.stringify(dmsTableMappings),
      replicationTaskSettings: JSON.stringify({
        BeforeImageSettings: {
          EnableBeforeImage: true,
          FieldName: "before",
          ColumnFilter: "all",
        }
      }),
    });

    const kinesisFn = new NodejsFunction(this, `stream-kinesis`, {
      ...lambdaProps,
      entry: join(__dirname, "lambda/stream-subscriber.ts"),
      tracing: Tracing.ACTIVE,
    });

    kinesisFn.addEventSource(
      new KinesisEventSource(dbStream, {
        batchSize: 100, // default
        startingPosition: StartingPosition.LATEST,
        filters: [
          { pattern: JSON.stringify({ partitionKey: [`${dbName}.${tableName}`] }) },
        ],
      })
    );

    const preDmsFn = new NodejsFunction(this, `pre-dms`, {
      ...lambdaProps,
      entry: join(__dirname, "lambda/dms-pre.ts"),
      environment: {
        STACK_NAME: Stack.of(this).stackName,
      },
      initialPolicy: [
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: [
            "cloudformation:Describe*",
            "cloudformation:Get*",
            "cloudformation:List*",
          ],
          resources: ["*"],
        }),
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ["dms:*"],
          resources: ["*"],
        }),
      ],
    });

    const postDmsFn = new NodejsFunction(this, `post-dms`, {
      ...lambdaProps,
      entry: join(__dirname, "lambda/dms-post.ts"),
      environment: {
        STACK_NAME: Stack.of(this).stackName,
        DMS_TASK: task.ref,
      },
      initialPolicy: [
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: [
            "cloudformation:Describe*",
            "cloudformation:Get*",
            "cloudformation:List*",
          ],
          resources: ["*"],
        }),
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ["dms:*"],
          resources: ["*"],
        }),
      ],
    });

    const preProvider = new Provider(this, `pre-dms-provider`, {
      onEventHandler: preDmsFn,
    });

    const preResource = new CustomResource(this, `pre-dms-resource`, {
      properties: { Version: new Date().getTime().toString() },
      serviceToken: preProvider.serviceToken,
    });

    const postProvider = new Provider(this, `post-dms-provider`, {
      onEventHandler: postDmsFn,
    });

    const postResource = new CustomResource(this, `post-dms-resource`, {
      properties: { Version: new Date().getTime().toString() },
      serviceToken: postProvider.serviceToken,
    });

    task.node.addDependency(preResource);
    postResource.node.addDependency(task);
  }
}
