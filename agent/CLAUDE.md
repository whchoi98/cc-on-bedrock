# Agent Module

## Role
Bedrock AgentCore Runtime에 배포되는 AI Assistant 에이전트. Strands 프레임워크 기반.

## Key Files
- `agent.py` - Strands Agent + BedrockAgentCoreApp 엔트리포인트, 5개 @tool 정의
- `Dockerfile` - Python 3.11 기반 컨테이너 이미지
- `requirements.txt` - bedrock-agentcore, strands-agents, boto3, requests

## AgentCore Resources
- **Runtime:** `cconbedrock_agent-xcceE4DydC` (ECR: cc-on-bedrock/agent)
- **Gateway:** `cconbedrock-analytics-gateway-sscxn8kufm` (MCP)
- **IAM Role:** `AWSopsAgentCoreRole`

## Tools
| Tool | Data Source | Description |
|------|-----------|-------------|
| `get_spend_summary` | LiteLLM API | 사용자별 요청/토큰/비용 집계 |
| `get_api_key_budgets` | LiteLLM API | API Key 예산/사용률 |
| `get_system_health` | LiteLLM API | Proxy/DB/Cache 상태 |
| `get_container_status` | ECS API | 컨테이너 상태/사용자 할당 |
| `get_container_metrics` | CloudWatch | CPU/Memory/Network 메트릭 |

## Commands
```bash
# Build & push
docker build --platform linux/arm64 -t 061525506239.dkr.ecr.ap-northeast-2.amazonaws.com/cc-on-bedrock/agent:latest .
docker push 061525506239.dkr.ecr.ap-northeast-2.amazonaws.com/cc-on-bedrock/agent:latest

# Update AgentCore Runtime (after ECR push)
aws bedrock-agentcore-control update-agent-runtime \
  --agent-runtime-id cconbedrock_agent-xcceE4DydC \
  --agent-runtime-artifact '{"containerConfiguration":{"containerUri":"061525506239.dkr.ecr.ap-northeast-2.amazonaws.com/cc-on-bedrock/agent:latest"}}' \
  --region ap-northeast-2

# Test invocation
aws bedrock-agentcore invoke-agent-runtime \
  --agent-runtime-arn arn:aws:bedrock-agentcore:ap-northeast-2:061525506239:runtime/cconbedrock_agent-xcceE4DydC \
  --qualifier DEFAULT \
  --payload $(echo -n '{"prompt":"hello"}' | base64 -w0) \
  --region ap-northeast-2 /tmp/response.json
```

## Rules
- `LITELLM_API_URL`, `LITELLM_MASTER_KEY`, `ECS_CLUSTER_NAME` 환경변수 필요
- `@app.entrypoint` 데코레이터로 AgentCore Runtime 서비스 계약 준수
- `app.run()` 으로 AgentCore가 실행 제어
