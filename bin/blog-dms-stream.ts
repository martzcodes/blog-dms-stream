#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { DatabaseStack } from "../lib/db-stack";
import { BlogDmsStreamStack } from "../lib/blog-dms-stream-stack";

const app = new cdk.App();

const dbName = "blog";
const tableName = "examples";

const dbStack = new DatabaseStack(app, "DatabaseStack", {
  dbName,
  tableName,
});

new BlogDmsStreamStack(app, "BlogDmsStreamStack", {
  dbName,
  secretName: dbStack.secret.secretName,
  securityGroupIds: dbStack.securityGroups.map((sg) => sg.securityGroupId),
  tableName,
  vpc: dbStack.vpc,
});
