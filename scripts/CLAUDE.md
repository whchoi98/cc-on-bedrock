# Scripts Module

## Role
프로젝트 초기 설정 + 운영 스크립트. 번호순 실행으로 첫 배포 완료.

## First-Time Setup (순서대로 실행)

| # | Script | Purpose |
|---|--------|---------|
| 00 | `00-check-prerequisites.sh` | CLI 도구, AWS 자격증명, Bedrock 모델, Route 53, Docker 확인 |
| 01 | `01-create-ecr-repos.sh` | ECR 리포지토리 생성 (devenv, dashboard, nginx) + lifecycle 정책 |
| 02 | `02-cdk-bootstrap.sh` | CDK 부트스트랩 (ap-northeast-2 + us-east-1) + npm install |
| 03 | `03-deploy-base-stacks.sh` | Network + Security CDK 스택 배포 |
| 04 | `04-setup-cognito-auth.sh` | Cognito SSM 파라미터, 관리자 생성, SAML/OIDC 연동 옵션 |
| 05 | `05-build-docker-images.sh` | Docker 이미지 빌드 + ECR 푸시 (ARM64) |
| 06 | `06-deploy-service-stacks.sh` | 나머지 CDK 스택 배포 (UsageTracking, WAF, EC2DevEnv, EcsDevenv, Dashboard) |
| 07 | `07-build-ami.sh` | DevEnv AMI 빌드 (ubuntu/al2023) |
| 08 | `08-verify-deployment.sh` | 전체 배포 검증 (스택, Cognito, SSM, ECR, DynamoDB, CloudFront) |

## Utility Scripts (순서 무관)
- `build-ami.sh` — AMI 빌드 실제 로직 (07이 래핑)
- `create-ecr-repos.sh` — ECR 생성 원본 (01이 확장판)
- `verify-deployment.sh` — 배포 검증 상세판 (23개 체크)
- `validate-deployment.sh` — 배포 유효성 검사

## Test/Data Scripts (운영용, 초기 설정 불필요)
- `create-enterprise-test-data.sh` — 엔터프라이즈 테스트 데이터 생성
- `create-test-users-30.sh` — 30명 테스트 유저 생성 (5개 부서)
- `generate-usage-data.py` — DynamoDB 사용량 시뮬레이션 데이터

## Migration Scripts (1회성)
- `migrate-role-tags.sh` — IAM 역할 태그 마이그레이션

## Rules
- 모든 스크립트는 `set -euo pipefail`로 시작
- AWS CLI 호출 시 `--region` 파라미터 명시
- 실패 시 명확한 에러 메시지 출력
- 번호 스크립트는 의존성 순서 보장 (앞 번호 먼저 실행)
