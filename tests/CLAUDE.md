# Tests Module

## Role
E2E 통합 테스트, Docker 컨테이너 테스트.

## Key Files
- `integration/test-e2e.sh` - 전체 E2E 테스트 (Docker, CDK, TF, CFN, Next.js, ShellCheck)
- `docker/test-devenv.sh` - DevEnv 컨테이너 통합 테스트

## Commands
```bash
bash tests/integration/test-e2e.sh              # 전체 E2E
bash tests/integration/test-e2e.sh --skip-docker # Docker 제외
bash tests/integration/test-e2e.sh --only-iac    # IaC만
bash tests/docker/test-devenv.sh                 # 컨테이너 테스트
```

## Rules
- 테스트는 idempotent (반복 실행 가능)
- `run_test` 함수로 결과 수집, 마지막에 summary 출력
