#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { defaultConfig } from '../config/default';

const app = new cdk.App();

// Read config overrides from CDK context
const config = {
  ...defaultConfig,
  vpcName: app.node.tryGetContext('vpcName') ?? defaultConfig.vpcName,
  vpcCidr: app.node.tryGetContext('vpcCidr') ?? defaultConfig.vpcCidr,
  publicSubnetCidrA: app.node.tryGetContext('publicSubnetCidrA') ?? defaultConfig.publicSubnetCidrA,
  publicSubnetCidrC: app.node.tryGetContext('publicSubnetCidrC') ?? defaultConfig.publicSubnetCidrC,
  privateSubnetCidrA: app.node.tryGetContext('privateSubnetCidrA') ?? defaultConfig.privateSubnetCidrA,
  privateSubnetCidrC: app.node.tryGetContext('privateSubnetCidrC') ?? defaultConfig.privateSubnetCidrC,
  isolatedSubnetCidrA: app.node.tryGetContext('isolatedSubnetCidrA') ?? defaultConfig.isolatedSubnetCidrA,
  isolatedSubnetCidrC: app.node.tryGetContext('isolatedSubnetCidrC') ?? defaultConfig.isolatedSubnetCidrC,
  domainName: app.node.tryGetContext('domainName') ?? defaultConfig.domainName,
  devSubdomain: app.node.tryGetContext('devSubdomain') ?? defaultConfig.devSubdomain,
};

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION ?? 'ap-northeast-2',
};

// Stacks will be added as they are implemented
// import { NetworkStack } from '../lib/01-network-stack';
// import { SecurityStack } from '../lib/02-security-stack';
// import { LitellmStack } from '../lib/03-litellm-stack';
// import { EcsDevenvStack } from '../lib/04-ecs-devenv-stack';
// import { DashboardStack } from '../lib/05-dashboard-stack';

console.log('CC-on-Bedrock CDK App initialized with config:', JSON.stringify(config, null, 2));
