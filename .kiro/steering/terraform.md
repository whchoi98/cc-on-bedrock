# Terraform Module

## Role
Terraform HCL로 전체 인프라 배포. 5개 모듈.

## Key Files
- `main.tf` - Root module, 모듈 호출 및 연결
- `variables.tf` / `outputs.tf` - 입력 변수, 출력값
- `providers.tf` - AWS provider (ap-northeast-2)
- `terraform.tfvars.example` - 예제 변수 값
- `modules/network/` - VPC, Subnets, NAT, VPC Endpoints, Route 53
- `modules/security/` - Cognito, ACM, KMS, Secrets Manager, IAM
- `modules/litellm/` - LiteLLM EC2 ASG, Internal ALB, RDS, Valkey
- `modules/ecs-devenv/` - ECS Cluster, Task Defs, EFS, ALB, CloudFront
- `modules/dashboard/` - Dashboard EC2 ASG, ALB, CloudFront

## Rules
- `terraform fmt -recursive` 후 커밋
- 모듈 간 의존성은 변수로 전달
- `terraform.tfvars.example`을 `terraform.tfvars`로 복사 후 사용

## Commands
```bash
cd terraform && terraform init
cd terraform && terraform validate
cd terraform && terraform fmt -recursive
cd terraform && terraform apply
```
