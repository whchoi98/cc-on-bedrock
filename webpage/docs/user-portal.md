---
sidebar_position: 2
---

# 내 환경 (My Environment)

import ProvisioningSteps from '@site/src/components/diagrams/ProvisioningSteps';

사용자 셀프서비스 포털로, 개발환경(code-server + Claude Code)을 직접 관리할 수 있습니다. 관리자 개입 없이 컨테이너 시작/중지, 디스크 관리, 비밀번호 설정이 가능합니다.

## 3-탭 구조

| 탭 | 기능 |
|----|------|
| **환경 정보** | SSE 실시간 프로비저닝, 컨테이너 상태, VSCode URL, CPU/Memory 메트릭, 토큰 사용량 |
| **스토리지** | 디스크 사용량 게이지, EBS 확장 신청/취소, Keep-Alive |
| **설정** | Code-server 비밀번호 조회/변경, Cognito 동기화, 계정 정보 |

:::tip 접근성
탭은 **ARIA tablist/tab/tabpanel** 패턴을 지원합니다. **Arrow Left/Right** 키로 탭 간 이동, 프로그레스 바는 `role="progressbar"`로 스크린리더에서 인식됩니다.
:::

---

## 환경 정보 탭 (Environment)

### SSE 프로비저닝

"Start Container" 버튼 클릭 시, Server-Sent Events로 6단계 프로비저닝이 실시간 진행됩니다.

<ProvisioningSteps />

각 단계는 **대기(gray) → 진행(blue, pulse) → 완료(green, ✓) → 실패(red, ✗)** 상태를 가지며, 실패 시 에러 메시지와 함께 Cancel 버튼이 표시됩니다.

:::info 소요 시간
일반적으로 **1-2분** 소요됩니다. Step 5 (Container Start)가 가장 오래 걸리며, Step 6 (Network)은 IP 할당을 최대 40초 대기합니다.
:::

### 컨테이너 상태 & VSCode URL

프로비저닝 완료 후:
- **상태 뱃지**: Running (green), Pending (yellow), Stopped (gray)
- **VSCode URL**: `https://{subdomain}.dev.{domain}` — 클릭 또는 복사 버튼
- **리소스 티어 선택**: Light (1 vCPU/2 GB) / Standard (2 vCPU/4 GB) / Power (4 vCPU/8 GB)
- **CPU/Memory 게이지 + 네트워크 I/O**: CloudWatch Container Insights 기반 실시간 메트릭

### 일일 사용량

토큰 사용량 프로그레스 바 (일일 한도 대비 %) + API 요청 수, 예상 비용 표시.

| 구간 | 색상 | 의미 |
|------|------|------|
| 0-70% | 🔵 Blue | 정상 |
| 70-90% | 🟡 Yellow | 주의 |
| 90-100% | 🔴 Red | 경고 |

---

## 스토리지 탭 (Storage)

### 디스크 사용량

| 스토리지 타입 | 표시 방식 |
|-------------|----------|
| **EBS** | 게이지 바 (사용량/총용량, %) — 80% 이상 경고, 90% 이상 위험 |
| **EFS** | 사용량만 표시 (자동 확장, 용량 제한 없음) |

### EBS 확장 신청

:::note EBS 모드 전용
EFS 사용자는 자동 확장이므로 이 기능이 표시되지 않습니다.
:::

1. **희망 크기 선택**: 40 / 60 / 100 GB (현재 크기보다 커야 함)
2. **사유 입력**: 최소 10자 (실시간 글자수 카운터)
3. **AI Review & Request**: AI가 리소스 사용 패턴을 분석하여 확장 권장 여부 판단
4. **관리자 승인**: Admin이 `/admin` 페이지에서 승인/거부
5. **자동 적용**: 승인 시 Lambda가 EBS 볼륨 자동 확장

신청 상태: `resize_pending` → `approved` / `rejected` → `completed`

### Keep-Alive

EBS 모드에서 컨테이너 실행 중 **유휴 타임아웃을 1시간 연장**합니다. 자동 볼륨 분리를 방지합니다.

---

## 설정 탭 (Settings)

### Code-Server 비밀번호

```
사용자 생성 시:
  Admin → TemporaryPassword → Cognito + Secrets Manager (양쪽 저장)
  → 이메일로 임시 비밀번호 발송

비밀번호 변경 (대시보드):
  사용자 입력 → AdminSetUserPassword (Cognito)
             → PutSecretValue (Secrets Manager)
             → 다음 컨테이너 시작 시 적용
```

- **현재 비밀번호 확인**: 마스킹 상태 → 눈 아이콘 토글 (10초 자동 숨김)
- **복사 버튼**: 클립보드 복사 + ✓ Copied! 피드백
- **비밀번호 변경**: 8-128자, 대문자/숫자/특수문자 필수
- **실행 중 주의**: 컨테이너 재시작 후 적용 (노란색 경고 배너)

### 계정 정보 (읽기 전용)

이메일, 서브도메인, 그룹, 보안정책, OS, 스토리지 타입, VSCode URL

---

## API 레퍼런스

| 엔드포인트 | 메서드 | 용도 |
|-----------|--------|------|
| `/api/user/container` | POST | 컨테이너 시작/중지 |
| `/api/user/container/stream` | POST | SSE 프로비저닝 진행상황 (6단계) |
| `/api/user/container-metrics` | GET | CloudWatch Container Insights 메트릭 |
| `/api/user/disk-usage` | GET | 디스크 사용량 (CloudWatch 기반) |
| `/api/user/ebs-resize` | GET/POST/DELETE | EBS 확장 신청/상태/취소 |
| `/api/user/password` | GET/POST | 비밀번호 조회/변경 |
| `/api/user/usage` | GET | 일일 토큰 사용량 |
| `/api/user/keep-alive` | POST | 유휴 타임아웃 연장 (EBS) |
| `/api/user/resource-review` | POST | AI 리소스 분석 (EBS 확장 전) |

모든 API는 **NextAuth 세션 인증** 필수이며, 본인 데이터만 접근 가능합니다.
