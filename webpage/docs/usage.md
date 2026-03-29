# 사용법 (Usage)

CC-on-Bedrock의 설치 및 사용 방법에 대한 안내입니다.

## 1. 인프라 배포 (Deployment)

시스템은 세 가지 IaC 도구 중 원하는 하나를 선택하여 배포할 수 있습니다.

### AWS CDK (권장)
```bash
cd cdk
npm install
npx cdk deploy --all
```

## 2. 대시보드 활용

배포 후 접속하는 메인 대시보드 화면입니다. 전체 클러스터 상태와 비용 현황을 한눈에 파악할 수 있습니다.

![Dashboard Home](/img/home.png)

### AI 비서 (AI Assistant)
Bedrock Converse API를 활용한 고속 스트리밍 채팅 환경을 제공합니다. 코드 분석 및 인프라 질문이 가능합니다.

![AI Assistant](/img/AI_Assistant.png)

### 사용자 및 컨테이너 관리
관리자는 Cognito 사용자를 관리하고, 각 사용자의 ECS 컨테이너를 제어할 수 있습니다.

<div style={{display: 'flex', gap: '10px'}}>
  <img src="/img/user.png" alt="User Management" style={{width: '48%'}} />
  <img src="/img/containers.png" alt="Container Management" style={{width: '48%'}} />
</div>

## 3. 개발 환경 접속 (Dev Environment)

1. 대시보드의 **Containers** 메뉴에서 자신의 컨테이너를 시작합니다.
2. 할당된 서브도메인 (예: `user1.dev.domain.com`)으로 접속합니다.
3. 웹 브라우저 기반의 VS Code (code-server) 환경이 실행됩니다.
