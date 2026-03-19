# Plan 3: Terraform (HCL) Implementation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement all 5 infrastructure modules using Terraform (HCL) for the CC-on-Bedrock platform, matching the CDK implementation 1:1.

**Architecture:** 5 Terraform modules invoked from a root main.tf. Each module maps to one CDK stack. Variables are defined in terraform.tfvars with the same defaults as CDK config.

**Tech Stack:** Terraform >= 1.5, AWS Provider >= 5.0

**Spec:** `docs/superpowers/specs/2026-03-19-cc-on-bedrock-design.md`
**CDK Reference:** `cdk/lib/*.ts` (same infrastructure)

---

## File Structure

```
cc-on-bedrock/terraform/
├── main.tf                    # Root module - calls all 5 modules
├── variables.tf               # Input variables
├── outputs.tf                 # Root outputs
├── terraform.tfvars.example   # Example variable values
├── providers.tf               # AWS provider config
├── modules/
│   ├── network/
│   │   ├── main.tf
│   │   ├── variables.tf
│   │   └── outputs.tf
│   ├── security/
│   │   ├── main.tf
│   │   ├── variables.tf
│   │   └── outputs.tf
│   ├── litellm/
│   │   ├── main.tf
│   │   ├── variables.tf
│   │   └── outputs.tf
│   ├── ecs-devenv/
│   │   ├── main.tf
│   │   ├── variables.tf
│   │   └── outputs.tf
│   └── dashboard/
│       ├── main.tf
│       ├── variables.tf
│       └── outputs.tf
```

---

## Tasks

### Task 1: Terraform Project Init + Network Module
### Task 2: Security Module
### Task 3: LiteLLM Module
### Task 4: ECS DevEnv Module
### Task 5: Dashboard Module + Root Wiring
### Task 6: Terraform Validate

Each task: create module files, update root main.tf, run `terraform validate`.

Full implementation code should reference the CDK stacks for exact resource configurations.
