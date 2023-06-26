import { Construct } from "constructs";
import {
  InstanceType,
  InstanceClass,
  InstanceSize,
  Vpc,
  IVpc,
  ISecurityGroup,
} from "aws-cdk-lib/aws-ec2";
import {
  DatabaseCluster,
  Credentials,
  DatabaseClusterEngine,
  AuroraMysqlEngineVersion,
} from "aws-cdk-lib/aws-rds";
import { Runtime } from "aws-cdk-lib/aws-lambda";
import { RetentionDays } from "aws-cdk-lib/aws-logs";
import { join } from "path";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { ISecret } from "aws-cdk-lib/aws-secretsmanager";
import { Provider } from "aws-cdk-lib/custom-resources";
import { Duration, StackProps, Stack, RemovalPolicy, CustomResource } from "aws-cdk-lib";

const lambdaProps = {
  runtime: Runtime.NODEJS_18_X,
  memorySize: 1028,
  timeout: Duration.minutes(15),
  logRetention: RetentionDays.ONE_DAY,
};

export interface DatabaseStackProps extends StackProps {
  dbName: string;
  tableName: string;
}

export class DatabaseStack extends Stack {
  secret: ISecret;
  securityGroups: ISecurityGroup[];
  vpc: IVpc;
  constructor(scope: Construct, id: string, props: DatabaseStackProps) {
    super(scope, id, props);

    const { dbName, tableName } = props;
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
      removalPolicy: RemovalPolicy.DESTROY,
      parameters: {
        binlog_format: "ROW",
        log_bin_trust_function_creators: "1",
        // https://aws.amazon.com/blogs/database/introducing-amazon-aurora-mysql-enhanced-binary-log-binlog/
        aurora_enhanced_binlog: "1",
        binlog_backup: "0",
        binlog_replication_globaldb: "0"
      },
    });
    db.connections.allowDefaultPortInternally();
    const secret = db.secret!;

    const initFn = new NodejsFunction(this, `db-init`, {
      ...lambdaProps,
      entry: join(__dirname, "lambda/db-init.ts"),
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
    initFn.node.addDependency(db);

    const initProvider = new Provider(this, `init-db-provider`, {
      onEventHandler: initFn,
    });

    new CustomResource(this, `init-db-resource`, {
      serviceToken: initProvider.serviceToken,
    });

    const seedFn = new NodejsFunction(this, `db-seed`, {
      ...lambdaProps,
      entry: join(__dirname, "lambda/db-seed.ts"),
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
    this.secret = db.secret!;
    this.vpc = vpc;
    this.securityGroups = db.connections.securityGroups;
  }
}
