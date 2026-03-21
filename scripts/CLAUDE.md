# Scripts Module

## Role
배포 검증, ECR 리포지토리 생성 등 운영 스크립트.

## Key Files
- `create-ecr-repos.sh` - ECR 리포지토리 생성 스크립트
- `verify-deployment.sh` - 배포 후 전체 서비스 검증 (23개 체크 항목)

## Rules
- 모든 스크립트는 `set -euo pipefail`로 시작
- AWS CLI 호출 시 `--region` 파라미터 명시
- 실패 시 명확한 에러 메시지 출력
