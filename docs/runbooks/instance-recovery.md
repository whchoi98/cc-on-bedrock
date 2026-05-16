# Runbook: EC2 DevEnv Instance Recovery

## Symptoms
- User reports "Environment not starting" or stuck provisioning
- Dashboard shows instance in `stopped`/`terminated` state but user expects it running
- CWAgent metrics missing for a specific instance

## Diagnosis

### 1. Check instance state
```bash
SUBDOMAIN="<user-subdomain>"
aws ec2 describe-instances \
  --filters "Name=tag:subdomain,Values=$SUBDOMAIN" "Name=tag:managed_by,Values=cc-on-bedrock" \
  --query 'Reservations[].Instances[].{Id:InstanceId,State:State.Name,LaunchTime:LaunchTime}' \
  --region ap-northeast-2 --output table
```

### 2. Check cloud-init logs (if instance is running)
```bash
INSTANCE_ID="<instance-id>"
aws ssm send-command --instance-ids $INSTANCE_ID \
  --document-name AWS-RunShellScript \
  --parameters 'commands=["tail -50 /var/log/cloud-init-output.log"]' \
  --region ap-northeast-2
```

### 3. Check DynamoDB routing entry
```bash
aws dynamodb get-item --table-name cc-routing-table \
  --key '{"subdomain":{"S":"<subdomain>"}}' \
  --region ap-northeast-2
```

## Resolution

### Instance stuck in stopping
```bash
aws ec2 stop-instances --instance-ids $INSTANCE_ID --force --region ap-northeast-2
```

### Instance terminated unexpectedly
User can recreate via dashboard `/user` page. Old EBS data is lost unless snapshot exists.

### CWAgent not reporting
```bash
aws ssm send-command --instance-ids $INSTANCE_ID \
  --document-name AWS-RunShellScript \
  --parameters 'commands=["amazon-cloudwatch-agent-ctl -a status","tail -10 /opt/aws/amazon-cloudwatch-agent/logs/amazon-cloudwatch-agent.log"]' \
  --region ap-northeast-2
```
Common cause: IAM role missing `cloudwatch:PutMetricData`. Fix: stop and start the instance (triggers IAM policy upsert).

### Routing table stale entry
```bash
aws dynamodb delete-item --table-name cc-routing-table \
  --key '{"subdomain":{"S":"<subdomain>"}}' \
  --region ap-northeast-2
```
Then restart instance from dashboard.

## Escalation
If none of the above resolves the issue, check ECS dashboard service logs:
```bash
aws logs tail /cc-on-bedrock/dashboard --since 30m --region ap-northeast-2
```
