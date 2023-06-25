import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import { SelfDestructConstruct } from "@aws-community/self-destruct";
import {
  InstanceType,
  InstanceClass,
  InstanceSize,
  Vpc,
} from "aws-cdk-lib/aws-ec2";
import {
  DatabaseCluster,
  Credentials,
  DatabaseClusterEngine,
  AuroraMysqlEngineVersion,
} from "aws-cdk-lib/aws-rds";
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

const lambdaProps = {
  runtime: Runtime.NODEJS_18_X,
  memorySize: 1028,
  timeout: cdk.Duration.minutes(15),
  logRetention: RetentionDays.ONE_DAY,
};

export class BlogDmsStreamStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const dbName = "blog";
    const tableName = "examples";
    const vpc = new Vpc(this, "vpc", {
      maxAzs: 2,
    });
    const db = new DatabaseCluster(this, "db", {
      clusterIdentifier: `db`,
      credentials: Credentials.fromGeneratedSecret("admin"),
      defaultDatabaseName: dbName,
      engine: DatabaseClusterEngine.auroraMysql({
        version: AuroraMysqlEngineVersion.VER_3_03_0,
      }),
      iamAuthentication: true,
      instanceProps: {
        instanceType: InstanceType.of(InstanceClass.T4G, InstanceSize.MEDIUM),
        vpc,
        vpcSubnets: {
          onePerAz: true,
        },
      },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      parameters: {
        binlog_format: "ROW",
        log_bin_trust_function_creators: "1",
      },
    });
    db.connections.allowDefaultPortInternally();
    const secret = db.secret!;

    const initFn = new NodejsFunction(this, `db-init`, {
      ...lambdaProps,
      entry: join(__dirname, "lambda/initialize-db.ts"),
      environment: {
        SECRET_ARN: secret.secretArn,
        DB_NAME: dbName,
        TABLE_NAME: tableName,
      },
      vpc,
      vpcSubnets: {
        onePerAz: true,
      },
      securityGroups: db.connections.securityGroups,
    });
    db.secret?.grantRead(initFn);

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

    const dmsRep = new CfnReplicationInstance(this, `dms-replication`, {
      replicationInstanceClass: "dms.t2.micro",
      multiAz: false,
      publiclyAccessible: false,
      replicationSubnetGroupIdentifier: dmsSubnet.ref,
      vpcSecurityGroupIds: db.connections.securityGroups.map(
        (sg) => sg.securityGroupId
      ),
    });

    const dbStream = new Stream(this, `db-stream`, {
      streamName: `db-stream`,
      streamMode: StreamMode.ON_DEMAND,
    });

    const dmsSecretRole = new Role(this, `dms-secret-role`, {
      assumedBy: new ServicePrincipal(
        `dms.${cdk.Stack.of(this).region}.amazonaws.com`
      ),
    });
    secret.grantRead(dmsSecretRole);

    const source = new CfnEndpoint(this, `dms-source-endpoint`, {
      endpointType: "source",
      engineName: "aurora",
      mySqlSettings: {
        secretsManagerAccessRoleArn: dmsSecretRole.roleArn,
        secretsManagerSecretId: secret.secretArn,
      },
    });

    const streamWriterRole = new Role(this, `dms-stream-role`, {
      assumedBy: new ServicePrincipal(
        `dms.${cdk.Stack.of(this).region}.amazonaws.com`
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
    });

    const kinesisFn = new NodejsFunction(this, `stream-kinesis`, {
      ...lambdaProps,
      entry: join(__dirname, "lambda/binlog-kinesis.ts"),
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
      entry: join(__dirname, "lambda/binlog-kinesis-pre.ts"),
      environment: {
        STACK_NAME: cdk.Stack.of(this).stackName,
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
      entry: join(__dirname, "lambda/binlog-kinesis-post.ts"),
      environment: {
        STACK_NAME: cdk.Stack.of(this).stackName,
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

    const preResource = new cdk.CustomResource(this, `pre-dms-resource`, {
      properties: { Version: new Date().getTime().toString() },
      serviceToken: preProvider.serviceToken,
    });

    const postProvider = new Provider(this, `post-dms-provider`, {
      onEventHandler: postDmsFn,
    });

    const postResource = new cdk.CustomResource(this, `post-dms-resource`, {
      properties: { Version: new Date().getTime().toString() },
      serviceToken: postProvider.serviceToken,
    });

    const seedFn = new NodejsFunction(this, `db-seed`, {
      ...lambdaProps,
      entry: join(__dirname, "lambda/seed-db.ts"),
      environment: {
        SECRET_ARN: secret.secretArn,
        DB_NAME: dbName,
        TABLE_NAME: tableName,
      },
      vpc,
      vpcSubnets: {
        onePerAz: true,
      },
      securityGroups: db.connections.securityGroups,
    });
    db.secret?.grantRead(seedFn);

    initFn.node.addDependency(db);
    task.node.addDependency(initFn);
    task.node.addDependency(preResource);
    postResource.node.addDependency(task);
    seedFn.node.addDependency(postResource);

    new SelfDestructConstruct(this, "SelfDestructConstruct", {
      duration: cdk.Duration.hours(24),
    });
  }
}
