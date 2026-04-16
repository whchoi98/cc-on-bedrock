import React, { useState } from 'react';
import styles from './ProvisioningSteps.module.css';

const steps = [
  { id: 1, title: 'Permissions', desc: 'Per-user IAM Task Role 생성 (Bedrock, S3, CloudWatch 권한)', detail: 'ensureUserTaskRole(subdomain) — cc-on-bedrock-task-{subdomain} 역할 생성 또는 재사용' },
  { id: 2, title: 'Storage', desc: 'EFS Access Point 생성 (사용자별 파일 격리)', detail: 'ensureUserAccessPoint(subdomain) — /users/{subdomain} 경로, UID/GID 1001' },
  { id: 3, title: 'Environment', desc: 'Task Definition revision 등록 (Access Point 연결)', detail: 'EFS 볼륨 설정 + per-user rootDirectory, transitEncryption ENABLED' },
  { id: 4, title: 'Security', desc: 'Code-server 비밀번호 저장 (Secrets Manager)', detail: '기존 비밀번호 유지 or 신규 생성 → cc-on-bedrock/codeserver/{subdomain}' },
  { id: 5, title: 'Container', desc: 'ECS Task 시작 (EC2, awsvpc, per-user IAM)', detail: 'RunTask — 보안 그룹, 서브넷, 환경변수, 태그 설정' },
  { id: 6, title: 'Network', desc: 'IP 할당 대기 + DynamoDB 라우트 등록', detail: 'Nginx 설정 자동 생성 → {subdomain}.dev.domain 접속 가능' },
];

export default function ProvisioningSteps() {
  const [activeStep, setActiveStep] = useState(1);

  return (
    <div className={styles.container}>
      <h3>SSE 프로비저닝 파이프라인 (6단계)</h3>
      <p className={styles.subtitle}>각 단계를 클릭하여 상세 정보를 확인하세요. Server-Sent Events로 실시간 진행상황이 전달됩니다.</p>
      <div className={styles.pipeline}>
        {steps.map((step) => (
          <div
            key={step.id}
            className={`${styles.step} ${activeStep === step.id ? styles.active : ''} ${activeStep > step.id ? styles.completed : ''}`}
            onClick={() => setActiveStep(step.id)}
          >
            <div className={styles.circle}>
              {activeStep > step.id ? '✓' : step.id}
            </div>
            <div className={styles.label}>{step.title}</div>
          </div>
        ))}
      </div>
      <div className={styles.detailBox}>
        <h4>Step {activeStep}: {steps[activeStep - 1].title}</h4>
        <p className={styles.desc}>{steps[activeStep - 1].desc}</p>
        <div className={styles.code}>
          <code>{steps[activeStep - 1].detail}</code>
        </div>
      </div>
      <div className={styles.apiInfo}>
        <code>POST /api/user/container/stream</code> — SSE event: <code>{`{step: ${activeStep}, name: "${steps[activeStep-1].title.toLowerCase()}", status: "completed"}`}</code>
      </div>
    </div>
  );
}
