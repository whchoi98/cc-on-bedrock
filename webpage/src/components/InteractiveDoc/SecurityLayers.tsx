import React, { useState } from 'react';
import styles from './SecurityLayers.module.css';

const layers = [
  { id: 'L1', name: 'CloudFront', detail: 'HTTPS Encryption (TLS 1.2+), AWS Shield DDoS Protection' },
  { id: 'L2', name: 'ALB', detail: 'Access blocked via CloudFront Prefix List and X-Custom-Secret header' },
  { id: 'L3', name: 'Cognito', detail: 'OAuth 2.0 Authentication, Admin/User group-based access control' },
  { id: 'L4', name: 'Security Groups', detail: '3-stage DLP: Open / Restricted / Locked policies' },
  { id: 'L5', name: 'VPC Endpoints', detail: 'Internal transmission avoiding the internet via AWS Private Link' },
  { id: 'L6', name: 'DNS Firewall', detail: '5 AWS threat lists and custom block lists applied' },
  { id: 'L7', name: 'IAM + DLP', detail: 'Per-model access control, budget Deny Policy, file transfer restrictions' },
];

export default function SecurityLayers() {
  const [activeLayer, setActiveLayer] = useState(layers[0]);

  return (
    <div className={styles.container}>
      <h3>보안 7계층 인터랙티브 (7-Layer Security)</h3>
      <div className={styles.content}>
        <div className={styles.stack}>
          {layers.map((layer) => (
            <div 
              key={layer.id} 
              className={`${styles.layer} ${activeLayer.id === layer.id ? styles.active : ''}`}
              onClick={() => setActiveLayer(layer)}
            >
              <span className={styles.layerId}>{layer.id}</span>
              <span className={styles.layerName}>{layer.name}</span>
            </div>
          ))}
        </div>
        <div className={styles.detailCard}>
          <h4>{activeLayer.id}: {activeLayer.name}</h4>
          <p>{activeLayer.detail}</p>
        </div>
      </div>
    </div>
  );
}
