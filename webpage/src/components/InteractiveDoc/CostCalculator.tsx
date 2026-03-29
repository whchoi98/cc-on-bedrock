import React, { useState } from 'react';
import styles from './CostCalculator.module.css';

export default function CostCalculator() {
  const [users, setUsers] = useState(10);
  const [hours, setHours] = useState(4);

  // Approximate costs (AWS Bedrock + ECS/Fargate)
  const computeCost = users * 15; // $15 per active user/month (ECS)
  const bedrockCost = users * hours * 2; // Rough estimate $2/hr of active usage
  const totalCost = computeCost + bedrockCost;
  const savings = 370; // LiteLLM vs Serverless tracking savings estimate

  return (
    <div className={styles.calculator}>
      <h3>실시간 비용 계산기 (Interactive Cost Calculator)</h3>
      <div className={styles.inputGroup}>
        <label>
          사용자 수: <strong>{users}명</strong>
          <input 
            type="range" min="1" max="100" value={users} 
            onChange={(e) => setUsers(parseInt(e.target.value))} 
          />
        </label>
        <label>
          하루 평균 사용 시간: <strong>{hours}시간</strong>
          <input 
            type="range" min="1" max="24" value={hours} 
            onChange={(e) => setHours(parseInt(e.target.value))} 
          />
        </label>
      </div>

      <div className={styles.results}>
        <div className={styles.resultItem}>
          <span>인프라 비용 (ECS/EFS):</span>
          <strong>${computeCost.toLocaleString()} /월</strong>
        </div>
        <div className={styles.resultItem}>
          <span>예상 Bedrock API 비용:</span>
          <strong>${bedrockCost.toLocaleString()} /월</strong>
        </div>
        <hr />
        <div className={styles.total}>
          <span>총 예상 월 비용:</span>
          <strong style={{color: 'var(--ifm-color-primary)'}}>${totalCost.toLocaleString()} /월</strong>
        </div>
        <div className={styles.savings}>
          <small>✨ LiteLLM 대신 서버리스 트래킹 사용 시 약 <strong>${savings}</strong> 절감 효과</small>
        </div>
      </div>
    </div>
  );
}
