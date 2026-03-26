# CC-on-Bedrock Enterprise Edition - Task 목록

> 생성일: 2026-03-26 | 설계 문서: [enterprise-edition-design.md](../specs/2026-03-26-enterprise-edition-design.md)
> 마지막 업데이트: 2026-03-26 (세션 완료)

## Phase 1: Foundation (4주)

- [x] **T1.1** EBS lifecycle Lambda 구현 ✅ `cdk/lib/lambda/ebs-lifecycle.py`
- [x] **T1.2** S3 sync 스크립트 구현 ✅ `docker/devenv/scripts/s3-sync.sh` + entrypoint.sh
- [x] **T1.3** .s3ignore 패턴 적용 ✅ s3-sync.sh 내 EXCLUDE_PATTERNS
- [x] **T1.4** EBS+S3 메타데이터 스키마 설계 ✅ .metadata.json
- [x] **T1.5** CDK S3 버킷 + DynamoDB + EBS Lambda ✅ `04-ecs-devenv-stack.ts`
- [x] **T1.6** aws-clients.ts Lambda/S3 연동 ✅
- [ ] **T1.7** Cognito SAML/OIDC Federation 설정 - Enterprise IdP 연동 필요 (고객별)
- [x] **T1.8** Cognito 그룹 확장: dept-manager ✅ CDK/TF/CFN 모두
- [ ] **T1.9** NextAuth.js SAML provider + 역할 매핑 - IdP 연동 후 진행
- [x] **T1.10** DynamoDB 테이블: department-budgets + user-volumes ✅ CDK/TF/CFN 모두
- [ ] **T1.11** 예산 Lambda 확장: 부서 월간 + 개인 일일 한도 체크

## Phase 2: User Experience (4주)

- [x] **T2.1** User Portal 페이지 ✅ `shared/nextjs-app/src/app/user/`
- [x] **T2.2** 사용자 셀프서비스 컨테이너 API ✅ `src/app/api/user/container/route.ts`
- [x] **T2.3** Dept Manager Dashboard ✅ `shared/nextjs-app/src/app/dept/`
- [x] **T2.4** 승인 큐 API ✅ `src/app/api/dept/route.ts`
- [ ] **T2.5** Admin Dashboard 토큰 사용량 차트
- [ ] **T2.6** 부서별/사용자별 예산 설정 Admin UI
- [x] **T2.7** 사용자 토큰 사용량 조회 API ✅ `src/app/api/user/usage/route.ts`
- [ ] **T2.8** EBS 증설 요청/승인 플로우
- [x] **T2.9** middleware.ts 역할별 라우트 분리 ✅

## Phase 3: Scale & Operations (4주)

- [ ] **T3.1** NLB 전환 (CDK: ALB → NLB)
- [ ] **T3.2** Nginx ECS Service 구현
- [ ] **T3.3** Nginx config 동적 생성 Lambda
- [ ] **T3.4** DynamoDB routing-table 테이블 + Stream
- [ ] **T3.5** Nginx S3 polling + reload
- [x] **T3.6** entrypoint SIGTERM trap ✅
- [x] **T3.7** Warm Stop Lambda ✅ `cdk/lib/lambda/warm-stop.py`
- [x] **T3.8** Idle Check Lambda ✅ `cdk/lib/lambda/idle-check.py`
- [ ] **T3.9** Keep Alive API endpoint + SNS 알림
- [x] **T3.10** EventBridge 스케줄 (idle 5분 + EOD 18:00) ✅ CDK
- [ ] **T3.11** 사용자 티어 선택 UI + 부서별 허용 티어 정책
- [x] **T3.12** 프롬프트 감사 ✅ `cdk/lib/lambda/audit-logger.py` + DynamoDB + EventBridge

## Phase 4: Hardening (2주)

- [x] **T4.1** 보안 리뷰 주요 이슈 수정 ✅ commit `835befd`
- [ ] **T4.2** 폐쇄망 프록시 설정
- [ ] **T4.3** CodeArtifact npm 미러 + ECR 프라이빗
- [ ] **T4.4** DR 전략: S3 Cross-Region Replication
- [ ] **T4.5** Locust 부하 테스트 스크립트
- [ ] **T4.6** 비용 모니터링 대시보드

## Terraform/CloudFormation 동기화

- [x] **TF1** S3 버킷 + DynamoDB user-volumes ✅
- [x] **TF2** dept-manager Cognito 그룹 ✅
- [x] **TF3** department-budgets DynamoDB ✅
- [x] **CFN1** S3 버킷 + DynamoDB user-volumes ✅
- [x] **CFN2** dept-manager Cognito 그룹 ✅
- [x] **CFN3** department-budgets DynamoDB ✅

---
**진행률**: 27/39 완료 (69%) | 미착수 12개 (주로 NLB/Nginx, IdP 연동, 부하 테스트)
**범례**: ✅ 완료 | 빈칸 = 미착수/고객별 설정 필요
