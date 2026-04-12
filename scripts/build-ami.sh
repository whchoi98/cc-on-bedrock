#!/bin/bash
set -euo pipefail

# CC-on-Bedrock AMI Builder
# Launches a temporary EC2 instance, runs setup scripts, creates AMI, terminates instance.
# Must run from an environment with AWS credentials and VPC access.
#
# Usage: ./build-ami.sh [ubuntu|al2023] [instance-type] [volume-size-gb]
# Example: ./build-ami.sh ubuntu t4g.medium 30
# Example: ./build-ami.sh al2023 t4g.medium 30

OS_TYPE="${1:-ubuntu}"
INSTANCE_TYPE="${2:-t4g.medium}"
VOLUME_SIZE="${3:-30}"
REGION="${AWS_REGION:-ap-northeast-2}"
AMI_NAME="cc-on-bedrock-devenv-${OS_TYPE}-$(date +%Y%m%d-%H%M%S)"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

if [[ "$OS_TYPE" != "ubuntu" && "$OS_TYPE" != "al2023" ]]; then
  echo "ERROR: OS type must be 'ubuntu' or 'al2023'"
  echo "Usage: $0 [ubuntu|al2023] [instance-type] [volume-size-gb]"
  exit 1
fi

echo "=== CC-on-Bedrock AMI Builder ==="
echo "OS type: $OS_TYPE"
echo "Instance type: $INSTANCE_TYPE"
echo "Volume size: ${VOLUME_SIZE}GB"
echo "Region: $REGION"

# Find base AMI based on OS type
echo "Finding base AMI for $OS_TYPE..."
if [ "$OS_TYPE" = "ubuntu" ]; then
  BASE_AMI=$(aws ec2 describe-images \
    --owners 099720109477 \
    --filters \
      "Name=name,Values=ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-arm64-server-*" \
      "Name=architecture,Values=arm64" \
      "Name=state,Values=available" \
    --query 'Images | sort_by(@, &CreationDate) | [-1].ImageId' \
    --output text \
    --region "$REGION")
else
  BASE_AMI=$(aws ec2 describe-images \
    --owners amazon \
    --filters \
      "Name=name,Values=al2023-ami-*-arm64" \
      "Name=architecture,Values=arm64" \
      "Name=state,Values=available" \
    --query 'Images | sort_by(@, &CreationDate) | [-1].ImageId' \
    --output text \
    --region "$REGION")
fi
echo "Base AMI: $BASE_AMI"

# Find a private subnet
SUBNET_ID=$(aws ec2 describe-subnets \
  --filters "Name=tag:Name,Values=*cc-on-bedrock*Private*" \
  --query 'Subnets[0].SubnetId' \
  --output text \
  --region "$REGION" 2>/dev/null)
if [ -z "$SUBNET_ID" ] || [ "$SUBNET_ID" = "None" ]; then
  SUBNET_ID=$(aws ec2 describe-subnets \
    --filters "Name=tag:aws-cdk:subnet-type,Values=Private" \
    --query 'Subnets[0].SubnetId' \
    --output text \
    --region "$REGION")
fi
echo "Subnet: $SUBNET_ID"

# Find IAM instance profile (reuse existing devenv role)
INSTANCE_PROFILE="cc-on-bedrock-devenv-builder"
aws iam get-instance-profile --instance-profile-name "$INSTANCE_PROFILE" &>/dev/null || {
  echo "Creating temporary instance profile..."
  ROLE_NAME="cc-on-bedrock-dashboard-ec2"
  aws iam create-instance-profile --instance-profile-name "$INSTANCE_PROFILE"
  aws iam add-role-to-instance-profile --instance-profile-name "$INSTANCE_PROFILE" --role-name "$ROLE_NAME"
  sleep 10  # Wait for propagation
}

# Find security group (SSM only, no SSH)
SG_ID=$(aws ec2 describe-security-groups \
  --filters "Name=group-name,Values=*DevenvSgOpen*" \
  --query 'SecurityGroups[0].GroupId' \
  --output text \
  --region "$REGION" 2>/dev/null)
if [ -z "$SG_ID" ] || [ "$SG_ID" = "None" ]; then
  SG_ID=$(aws ec2 describe-security-groups \
    --filters "Name=tag:Name,Values=*cc-on-bedrock*" \
    --query 'SecurityGroups[0].GroupId' \
    --output text \
    --region "$REGION")
fi
echo "Security Group: $SG_ID"

# Launch temporary instance
echo "Launching build instance..."
INSTANCE_ID=$(aws ec2 run-instances \
  --image-id "$BASE_AMI" \
  --instance-type "$INSTANCE_TYPE" \
  --subnet-id "$SUBNET_ID" \
  --security-group-ids "$SG_ID" \
  --iam-instance-profile Name="$INSTANCE_PROFILE" \
  --block-device-mappings "[{\"DeviceName\":\"/dev/sda1\",\"Ebs\":{\"VolumeSize\":$VOLUME_SIZE,\"VolumeType\":\"gp3\",\"Encrypted\":true}}]" \
  --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=cc-ami-builder},{Key=managed_by,Value=cc-on-bedrock}]" \
  --metadata-options "HttpTokens=required,HttpPutResponseHopLimit=2" \
  --query 'Instances[0].InstanceId' \
  --output text \
  --region "$REGION")
echo "Instance: $INSTANCE_ID"

echo "Waiting for instance to be running..."
aws ec2 wait instance-running --instance-ids "$INSTANCE_ID" --region "$REGION"

echo "Waiting for SSM agent..."
for i in $(seq 1 30); do
  STATUS=$(aws ssm describe-instance-information \
    --filters "Key=InstanceIds,Values=$INSTANCE_ID" \
    --query 'InstanceInformationList[0].PingStatus' \
    --output text \
    --region "$REGION" 2>/dev/null || echo "None")
  if [ "$STATUS" = "Online" ]; then break; fi
  echo "  Waiting... ($i/30)"
  sleep 10
done

if [ "$STATUS" != "Online" ]; then
  echo "ERROR: SSM agent not online after 5 minutes"
  aws ec2 terminate-instances --instance-ids "$INSTANCE_ID" --region "$REGION"
  exit 1
fi

echo "=== Running setup scripts via SSM ==="

# Upload and run setup scripts
run_script() {
  local script_path="$1"
  local script_name=$(basename "$script_path")
  echo "Running $script_name..."

  # Read script content, wrap in bash + prepend environment for SSM (which uses /bin/sh)
  local script_content
  script_content="#!/bin/bash
export HOME=/root
export DEBIAN_FRONTEND=noninteractive
$(cat "$script_path")"

  COMMAND_ID=$(aws ssm send-command \
    --instance-ids "$INSTANCE_ID" \
    --document-name "AWS-RunShellScript" \
    --parameters "{\"commands\":[$(echo "$script_content" | jq -Rs .)]}" \
    --timeout-seconds 600 \
    --query 'Command.CommandId' \
    --output text \
    --region "$REGION")

  # Wait for completion
  aws ssm wait command-executed \
    --command-id "$COMMAND_ID" \
    --instance-id "$INSTANCE_ID" \
    --region "$REGION" 2>/dev/null || true

  STATUS=$(aws ssm get-command-invocation \
    --command-id "$COMMAND_ID" \
    --instance-id "$INSTANCE_ID" \
    --query 'Status' \
    --output text \
    --region "$REGION")

  if [ "$STATUS" != "Success" ]; then
    echo "ERROR: $script_name failed (status: $STATUS)"
    aws ssm get-command-invocation \
      --command-id "$COMMAND_ID" \
      --instance-id "$INSTANCE_ID" \
      --query 'StandardErrorContent' \
      --output text \
      --region "$REGION"
    aws ec2 terminate-instances --instance-ids "$INSTANCE_ID" --region "$REGION"
    exit 1
  fi
  echo "  $script_name completed"
}

run_script "$PROJECT_ROOT/docker/devenv/scripts/setup-common.sh"
run_script "$PROJECT_ROOT/docker/devenv/scripts/setup-claude-code.sh"
run_script "$PROJECT_ROOT/docker/devenv/scripts/setup-kiro.sh"

# Install SSM agent + CloudWatch agent + code-server systemd service
echo "Running EC2-specific setup for $OS_TYPE..."

# Build EC2-specific setup script (OS-aware)
EC2_SETUP_SCRIPT=$(mktemp)
cat > "$EC2_SETUP_SCRIPT" << 'SETUP_COMMON'
#!/bin/bash
set -euo pipefail
export HOME=/root

# Detect OS
if [ -f /etc/os-release ]; then
  . /etc/os-release
fi

# Install CloudWatch Agent
if command -v apt-get &>/dev/null; then
  wget -q https://amazoncloudwatch-agent.s3.amazonaws.com/ubuntu/arm64/latest/amazon-cloudwatch-agent.deb -O /tmp/cw-agent.deb
  dpkg -i /tmp/cw-agent.deb && rm /tmp/cw-agent.deb
  rm -f /usr/lib/python3*/EXTERNALLY-MANAGED
else
  dnf install -y amazon-cloudwatch-agent
fi

# Configure CloudWatch Agent
mkdir -p /opt/aws/amazon-cloudwatch-agent/etc
cat > /opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json << 'CWCFG'
{
  "metrics": {
    "namespace": "CWAgent",
    "append_dimensions": { "InstanceId": "${aws:InstanceId}" },
    "aggregation_dimensions": [["InstanceId"]],
    "metrics_collected": {
      "mem": {
        "measurement": ["mem_used_percent", "mem_used", "mem_total"],
        "metrics_collection_interval": 60
      },
      "disk": {
        "measurement": ["disk_used_percent", "disk_used", "disk_total"],
        "resources": ["/"],
        "metrics_collection_interval": 60
      }
    }
  }
}
CWCFG
systemctl enable amazon-cloudwatch-agent

# code-server systemd service
cat > /etc/systemd/system/code-server.service << 'EOF'
[Unit]
Description=code-server
After=network.target

[Service]
Type=simple
User=coder
Environment=CLAUDE_CODE_USE_BEDROCK=1
ExecStart=/usr/bin/code-server --bind-addr 0.0.0.0:8080 --auth password
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload

# Pre-create code-server config
sudo -u coder mkdir -p /home/coder/.config/code-server /home/coder/workspace
cat > /home/coder/.config/code-server/config.yaml << 'CSCFG'
bind-addr: 0.0.0.0:8080
auth: password
password: changeme
cert: false
CSCFG
chown -R coder:coder /home/coder/.config /home/coder/workspace
systemctl enable code-server

# Cleanup
if command -v apt-get &>/dev/null; then
  apt-get clean && rm -rf /var/lib/apt/lists/* /tmp/*
else
  dnf clean all && rm -rf /tmp/*
fi
echo "AMI EC2 setup complete"
SETUP_COMMON

run_script "$EC2_SETUP_SCRIPT"
rm -f "$EC2_SETUP_SCRIPT"

aws ssm wait command-executed --command-id "$COMMAND_ID" --instance-id "$INSTANCE_ID" --region "$REGION" 2>/dev/null || true

# Stop instance before creating AMI (clean state)
echo "Stopping instance for AMI creation..."
aws ec2 stop-instances --instance-ids "$INSTANCE_ID" --region "$REGION"
aws ec2 wait instance-stopped --instance-ids "$INSTANCE_ID" --region "$REGION"

# Create AMI
echo "Creating AMI: $AMI_NAME..."
if [ "$OS_TYPE" = "ubuntu" ]; then
  AMI_DESC="CC-on-Bedrock DevEnv: Ubuntu 24.04 ARM64 + code-server + Claude Code + Kiro"
else
  AMI_DESC="CC-on-Bedrock DevEnv: Amazon Linux 2023 ARM64 + code-server + Claude Code + Kiro"
fi

AMI_ID=$(aws ec2 create-image \
  --instance-id "$INSTANCE_ID" \
  --name "$AMI_NAME" \
  --description "$AMI_DESC" \
  --tag-specifications "ResourceType=image,Tags=[{Key=Name,Value=$AMI_NAME},{Key=managed_by,Value=cc-on-bedrock},{Key=os_type,Value=$OS_TYPE}]" \
  --query 'ImageId' \
  --output text \
  --region "$REGION")
echo "AMI ID: $AMI_ID"

echo "Waiting for AMI to be available..."
aws ec2 wait image-available --image-ids "$AMI_ID" --region "$REGION"

# Store AMI ID in per-OS SSM Parameter
aws ssm put-parameter \
  --name "/cc-on-bedrock/devenv/ami-id/${OS_TYPE}" \
  --value "$AMI_ID" \
  --type String \
  --overwrite \
  --region "$REGION"
echo "AMI ID stored in SSM: /cc-on-bedrock/devenv/ami-id/${OS_TYPE}"

# Also update legacy single parameter for backward compatibility (ubuntu only)
if [ "$OS_TYPE" = "ubuntu" ]; then
  aws ssm put-parameter \
    --name "/cc-on-bedrock/devenv/ami-id" \
    --value "$AMI_ID" \
    --type String \
    --overwrite \
    --region "$REGION"
  echo "Legacy SSM also updated: /cc-on-bedrock/devenv/ami-id"
fi

# Terminate build instance
echo "Terminating build instance..."
aws ec2 terminate-instances --instance-ids "$INSTANCE_ID" --region "$REGION"

echo "=== AMI Build Complete ==="
echo "OS Type: $OS_TYPE"
echo "AMI ID: $AMI_ID"
echo "AMI Name: $AMI_NAME"
echo "SSM Parameter: /cc-on-bedrock/devenv/ami-id/${OS_TYPE}"
