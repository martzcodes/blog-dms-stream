#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { BlogDmsStreamStack } from '../lib/blog-dms-stream-stack';

const app = new cdk.App();
new BlogDmsStreamStack(app, 'BlogDmsStreamStack');