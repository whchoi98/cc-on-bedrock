# AgentCore Runtime + Gateway 전환 계획

## 목표 아키텍처

```
Dashboard (Next.js) ─── InvokeAgentRuntime ──→ Runtime (agent.py/Strands)
                                                    │
Slack Bot (향후) ──── InvokeAgentRuntime ──→         │
                                                    │ MCP Protocol
                                                    ▼
                                              Gateway (MCP)
                                                    │
                                    ┌───────────────┼───────────────┐
                                    ▼               ▼               ▼
                              Lambda: ECS     Lambda: CW      Lambda: DDB
                              (컨테이너)       (메트릭)         (사용량)
```

## 구현 단계

### Phase 1: Lambda Tool 함수 생성
CC-on-Bedrock 전용 3개 Lambda (awsops의 lambda/ 패턴 참조)

| Lambda | 파일 | Tool 목록 |
|--------|------|----------|
| cc-ecs-mcp | `agent/lambda/cc_ecs_mcp.py` | get_container_status, get_efs_info |
| cc-cloudwatch-mcp | `agent/lambda/cc_cloudwatch_mcp.py` | get_container_metrics |
| cc-dynamodb-mcp | `agent/lambda/cc_dynamodb_mcp.py` | get_spend_summary, get_budget_status, get_system_health |

### Phase 2: Gateway 생성 + Target 등록
- Gateway 1개: `cconbedrock-gateway`
- Lambda Target 3개 등록
- SigV4 인증

### Phase 3: Runtime agent.py 재작성
awsops 패턴 적용:
- Strands Agent + MCPClient
- SigV4 서명된 Gateway 연결
- Skill prompt (정적 패턴 + 동적 Tool 목록)
- 대화 히스토리 지원
- 폴백: Gateway 실패 시 Bedrock 직접

### Phase 4: Docker 빌드 + ECR push + Runtime 등록

### Phase 5: Dashboard `/api/ai/route.ts` 재작성
- ConverseStreamCommand → InvokeAgentRuntime
- SSE 스트리밍 중계
- AgentCore Memory 연동 유지

### Phase 6: Slack 연동 준비 (향후)
- Slack Bot → InvokeAgentRuntime (동일 Agent 공유)
