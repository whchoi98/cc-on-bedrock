export interface CcOnBedrockConfig {
  // Network
  vpcName: string;
  vpcCidr: string;
  publicSubnetCidrA: string;
  publicSubnetCidrC: string;
  privateSubnetCidrA: string;
  privateSubnetCidrC: string;
  isolatedSubnetCidrA: string;
  isolatedSubnetCidrC: string;

  // Domain
  domainName: string;
  devSubdomain: string;

  // Models
  opusModelId: string;
  sonnetModelId: string;

  // Compute
  litellmInstanceType: string;
  ecsHostInstanceType: string;
  dashboardInstanceType: string;
  rdsInstanceType: string;
}

export const defaultConfig: CcOnBedrockConfig = {
  vpcName: 'cc-on-bedrock-vpc',
  vpcCidr: '10.0.0.0/16',
  publicSubnetCidrA: '10.0.1.0/24',
  publicSubnetCidrC: '10.0.2.0/24',
  privateSubnetCidrA: '10.0.16.0/20',
  privateSubnetCidrC: '10.0.32.0/20',
  isolatedSubnetCidrA: '10.0.100.0/23',
  isolatedSubnetCidrC: '10.0.102.0/23',
  domainName: 'example.com',
  devSubdomain: 'dev',
  opusModelId: 'global.anthropic.claude-opus-4-6-v1[1m]',
  sonnetModelId: 'global.anthropic.claude-sonnet-4-6[1m]',
  litellmInstanceType: 't4g.xlarge',
  ecsHostInstanceType: 'm7g.4xlarge',
  dashboardInstanceType: 't4g.xlarge',
  rdsInstanceType: 'db.t4g.medium',
};
