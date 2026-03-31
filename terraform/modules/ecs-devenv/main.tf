###############################################################################
# ECS DevEnv Module - Cluster, Task Definitions, EFS, NLB+Nginx, CloudFront, DLP SGs
# Equivalent to cdk/lib/04-ecs-devenv-stack.ts
###############################################################################

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

# ---- IAM: ECS Task Role (created here to match CDK pattern) -----------------
data "aws_iam_policy_document" "ecs_tasks_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "ecs_task" {
  name               = "cc-on-bedrock-ecs-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}

resource "aws_iam_role_policy" "ecs_task_bedrock" {
  name = "bedrock-invoke"
  role = aws_iam_role.ecs_task.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"]
      Resource = "*"
    }]
  })
}

# ---- IAM: ECS Task Execution Role -------------------------------------------
resource "aws_iam_role" "ecs_task_execution" {
  name               = "cc-on-bedrock-ecs-task-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}

resource "aws_iam_role_policy_attachment" "ecs_exec_policy" {
  role       = aws_iam_role.ecs_task_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy_attachment" "ecs_exec_ecr" {
  role       = aws_iam_role.ecs_task_execution.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly"
}

resource "aws_iam_role_policy" "ecs_exec_secrets" {
  name = "secrets-access"
  role = aws_iam_role.ecs_task_execution.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["secretsmanager:GetSecretValue"]
      Resource = "arn:aws:secretsmanager:*:${data.aws_caller_identity.current.account_id}:secret:cc-on-bedrock/*"
    }]
  })
}

# ---- ECR Repository ----------------------------------------------------------
resource "aws_ecr_repository" "devenv" {
  name                 = "cc-on-bedrock/devenv"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "KMS"
    kms_key         = var.kms_key_arn
  }
}

# ---- EFS File System ---------------------------------------------------------
resource "aws_efs_file_system" "this" {
  encrypted  = true
  kms_key_id = var.kms_key_arn

  performance_mode = "generalPurpose"
  throughput_mode  = "bursting"

  lifecycle_policy {
    transition_to_ia = "AFTER_30_DAYS"
  }

  tags = { Name = "cc-on-bedrock-devenv" }
}

resource "aws_efs_mount_target" "isolated_a" {
  file_system_id  = aws_efs_file_system.this.id
  subnet_id       = var.isolated_subnet_ids[0]
  security_groups = [aws_security_group.efs.id]
}

resource "aws_efs_mount_target" "isolated_c" {
  file_system_id  = aws_efs_file_system.this.id
  subnet_id       = var.isolated_subnet_ids[1]
  security_groups = [aws_security_group.efs.id]
}

# ---- DLP Security Groups ----------------------------------------------------
resource "aws_security_group" "dlp_open" {
  name_prefix = "cc-devenv-open-"
  description = "DLP: Open - all outbound"
  vpc_id      = var.vpc_id

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "cc-devenv-sg-open" }
}

resource "aws_security_group" "dlp_restricted" {
  name_prefix = "cc-devenv-restricted-"
  description = "DLP: Restricted - whitelist outbound"
  vpc_id      = var.vpc_id

  egress {
    description = "Allow VPC internal"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = [var.vpc_cidr]
  }

  egress {
    description = "Allow HTTPS for whitelisted domains"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "cc-devenv-sg-restricted" }
}

resource "aws_security_group" "dlp_locked" {
  name_prefix = "cc-devenv-locked-"
  description = "DLP: Locked - VPC only"
  vpc_id      = var.vpc_id

  egress {
    description = "Allow VPC internal only"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = [var.vpc_cidr]
  }

  tags = { Name = "cc-devenv-sg-locked" }
}

# ---- EFS Security Group (allow from all DLP SGs) ----------------------------
resource "aws_security_group" "efs" {
  name_prefix = "cc-devenv-efs-"
  description = "Allow NFS from devenv DLP SGs"
  vpc_id      = var.vpc_id

  ingress {
    description     = "Allow EFS from devenv (open)"
    from_port       = 2049
    to_port         = 2049
    protocol        = "tcp"
    security_groups = [aws_security_group.dlp_open.id]
  }

  ingress {
    description     = "Allow EFS from devenv (restricted)"
    from_port       = 2049
    to_port         = 2049
    protocol        = "tcp"
    security_groups = [aws_security_group.dlp_restricted.id]
  }

  ingress {
    description     = "Allow EFS from devenv (locked)"
    from_port       = 2049
    to_port         = 2049
    protocol        = "tcp"
    security_groups = [aws_security_group.dlp_locked.id]
  }

  tags = { Name = "cc-devenv-efs-sg" }
}

# ---- ECS Cluster -------------------------------------------------------------
resource "aws_ecs_cluster" "this" {
  name = "cc-on-bedrock-devenv"

  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

# ---- ECS Capacity Provider (m7g.4xlarge ASG) ---------------------------------
data "aws_ssm_parameter" "ecs_arm64_ami" {
  name = "/aws/service/ecs/optimized-ami/amazon-linux-2023/arm64/recommended/image_id"
}

resource "aws_launch_template" "ecs_capacity" {
  name_prefix   = "cc-devenv-ecs-"
  image_id      = data.aws_ssm_parameter.ecs_arm64_ami.value
  instance_type = var.ecs_host_instance_type

  user_data = base64encode(<<-USERDATA
#!/bin/bash
echo "ECS_CLUSTER=${aws_ecs_cluster.this.name}" >> /etc/ecs/ecs.config
USERDATA
  )

  tag_specifications {
    resource_type = "instance"
    tags          = { Name = "cc-devenv-ecs-host" }
  }
}

resource "aws_autoscaling_group" "ecs_capacity" {
  name                = "cc-devenv-ecs-capacity"
  min_size            = 0
  max_size            = 15
  desired_capacity    = 0
  vpc_zone_identifier = var.private_subnet_ids

  protect_from_scale_in = false

  launch_template {
    id      = aws_launch_template.ecs_capacity.id
    version = "$Latest"
  }

  tag {
    key                 = "Name"
    value               = "cc-devenv-ecs-host"
    propagate_at_launch = true
  }

  tag {
    key                 = "AmazonECSManaged"
    value               = "true"
    propagate_at_launch = true
  }
}

resource "aws_ecs_capacity_provider" "this" {
  name = "cc-devenv-capacity-provider"

  auto_scaling_group_provider {
    auto_scaling_group_arn         = aws_autoscaling_group.ecs_capacity.arn
    managed_termination_protection = "DISABLED"

    managed_scaling {
      status                    = "ENABLED"
      target_capacity           = 80
      minimum_scaling_step_size = 1
      maximum_scaling_step_size = 10
    }
  }
}

resource "aws_ecs_cluster_capacity_providers" "this" {
  cluster_name       = aws_ecs_cluster.this.name
  capacity_providers = [aws_ecs_capacity_provider.this.name]
}

# ---- CloudWatch Log Group ----------------------------------------------------
resource "aws_cloudwatch_log_group" "devenv" {
  name              = "/cc-on-bedrock/ecs/devenv"
  retention_in_days = 30
}

# ---- ECS Task Definitions (6 variants: 2 OS x 3 tiers) ----------------------
locals {
  tiers = {
    light    = { cpu = 1024, memory = 4096 }
    standard = { cpu = 2048, memory = 8192 }
    power    = { cpu = 4096, memory = 12288 }
  }
  os_variants = ["ubuntu", "al2023"]
  task_combos = flatten([
    for os in local.os_variants : [
      for tier_name, tier in local.tiers : {
        key    = "${os}-${tier_name}"
        os     = os
        tier   = tier_name
        cpu    = tier.cpu
        memory = tier.memory
      }
    ]
  ])
}

resource "aws_ecs_task_definition" "devenv" {
  for_each = { for tc in local.task_combos : tc.key => tc }

  family       = "devenv-${each.key}"
  network_mode = "awsvpc"

  task_role_arn      = aws_iam_role.ecs_task.arn
  execution_role_arn = aws_iam_role.ecs_task_execution.arn

  container_definitions = jsonencode([{
    name      = "devenv"
    image     = "${data.aws_caller_identity.current.account_id}.dkr.ecr.${data.aws_region.current.name}.amazonaws.com/cc-on-bedrock/devenv:${each.value.os}-latest"
    cpu       = each.value.cpu
    memory    = each.value.memory
    essential = true

    portMappings = [{ containerPort = 8080 }]

    environment = [
      { name = "AWS_DEFAULT_REGION", value = "ap-northeast-2" },
      { name = "SECURITY_POLICY", value = "open" },
    ]

    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.devenv.name
        "awslogs-region"        = data.aws_region.current.name
        "awslogs-stream-prefix" = "${each.value.os}-${each.value.tier}"
      }
    }

    mountPoints = [{
      sourceVolume  = "efs-workspace"
      containerPath = "/home/coder"
      readOnly      = false
    }]
  }])

  volume {
    name = "efs-workspace"
    efs_volume_configuration {
      file_system_id     = aws_efs_file_system.this.id
      transit_encryption = "ENABLED"
    }
  }

  tags = { Name = "devenv-${each.key}" }
}

# ════════════════════════════════════════════════════════════════════════════
# NLB + Nginx Routing (replaces ALB — unlimited users, L4+L7)
# Flow: CloudFront → NLB → Nginx → ECS Containers
# ════════════════════════════════════════════════════════════════════════════

# ---- DynamoDB Routing Table --------------------------------------------------
resource "aws_dynamodb_table" "routing" {
  name         = "cc-routing-table"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "subdomain"

  attribute {
    name = "subdomain"
    type = "S"
  }

  stream_enabled   = true
  stream_view_type = "NEW_AND_OLD_IMAGES"

  tags = { Name = "cc-routing-table" }
}

# ---- S3 Bucket for Nginx Config ---------------------------------------------
resource "aws_s3_bucket" "nginx_config" {
  bucket        = "cc-on-bedrock-nginx-config-${data.aws_caller_identity.current.account_id}"
  force_destroy = true
  tags          = { Name = "cc-nginx-config" }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "nginx_config" {
  bucket = aws_s3_bucket.nginx_config.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# ---- Nginx Config Generator Lambda ------------------------------------------
data "archive_file" "nginx_config_gen" {
  type        = "zip"
  source_file = "${path.module}/../../cdk/lib/lambda/nginx-config-gen.py"
  output_path = "${path.module}/.build/nginx-config-gen.zip"
}

resource "aws_iam_role" "nginx_config_gen" {
  name = "cc-nginx-config-gen"
  assume_role_policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Principal = { Service = "lambda.amazonaws.com" }, Action = "sts:AssumeRole" }]
  })
}

resource "aws_iam_role_policy_attachment" "nginx_config_gen_basic" {
  role       = aws_iam_role.nginx_config_gen.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "nginx_config_gen" {
  name = "dynamodb-s3-access"
  role = aws_iam_role.nginx_config_gen.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Effect = "Allow", Action = ["dynamodb:Scan", "dynamodb:GetItem", "dynamodb:Query"], Resource = aws_dynamodb_table.routing.arn },
      { Effect = "Allow", Action = ["s3:PutObject"], Resource = "${aws_s3_bucket.nginx_config.arn}/*" },
    ]
  })
}

resource "aws_lambda_function" "nginx_config_gen" {
  function_name    = "cc-nginx-config-gen"
  handler          = "nginx-config-gen.handler"
  runtime          = "python3.12"
  role             = aws_iam_role.nginx_config_gen.arn
  filename         = data.archive_file.nginx_config_gen.output_path
  source_code_hash = data.archive_file.nginx_config_gen.output_base64sha256
  timeout          = 30
  memory_size      = 256

  environment {
    variables = {
      ROUTING_TABLE     = aws_dynamodb_table.routing.table_name
      CONFIG_BUCKET     = aws_s3_bucket.nginx_config.id
      CONFIG_KEY        = "nginx/nginx.conf"
      DEV_DOMAIN        = "${var.dev_subdomain}.${var.domain_name}"
      CLOUDFRONT_SECRET = var.cloudfront_secret_value
    }
  }
}

resource "aws_lambda_event_source_mapping" "routing_stream" {
  event_source_arn       = aws_dynamodb_table.routing.stream_arn
  function_name          = aws_lambda_function.nginx_config_gen.arn
  starting_position      = "TRIM_HORIZON"
  batch_size             = 10
  maximum_retry_attempts = 3
}

# ---- Nginx Security Group ---------------------------------------------------
resource "aws_security_group" "nginx" {
  name_prefix = "cc-nginx-"
  description = "Nginx router SG"
  vpc_id      = var.vpc_id

  ingress {
    description = "Allow NLB traffic (Nginx validates X-Custom-Secret)"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "cc-nginx-sg" }
}

# Allow Nginx → DevEnv containers on port 8080
resource "aws_security_group_rule" "devenv_from_nginx_open" {
  type                     = "ingress"
  from_port                = 8080
  to_port                  = 8080
  protocol                 = "tcp"
  source_security_group_id = aws_security_group.nginx.id
  security_group_id        = aws_security_group.dlp_open.id
  description              = "Allow from Nginx router"
}

resource "aws_security_group_rule" "devenv_from_nginx_restricted" {
  type                     = "ingress"
  from_port                = 8080
  to_port                  = 8080
  protocol                 = "tcp"
  source_security_group_id = aws_security_group.nginx.id
  security_group_id        = aws_security_group.dlp_restricted.id
  description              = "Allow from Nginx router"
}

resource "aws_security_group_rule" "devenv_from_nginx_locked" {
  type                     = "ingress"
  from_port                = 8080
  to_port                  = 8080
  protocol                 = "tcp"
  source_security_group_id = aws_security_group.nginx.id
  security_group_id        = aws_security_group.dlp_locked.id
  description              = "Allow from Nginx router"
}

# ---- Nginx ECS Task Definition -----------------------------------------------
resource "aws_ecs_task_definition" "nginx" {
  family             = "cc-nginx-router"
  network_mode       = "awsvpc"
  execution_role_arn = aws_iam_role.ecs_task_execution.arn

  container_definitions = jsonencode([{
    name      = "nginx"
    image     = "${data.aws_caller_identity.current.account_id}.dkr.ecr.${data.aws_region.current.name}.amazonaws.com/cc-on-bedrock/nginx:latest"
    cpu       = 512
    memory    = 1024
    essential = true

    portMappings = [{ containerPort = 80 }]

    environment = [
      { name = "CONFIG_BUCKET", value = aws_s3_bucket.nginx_config.id },
      { name = "CONFIG_KEY", value = "nginx/nginx.conf" },
      { name = "RELOAD_INTERVAL", value = "5" },
    ]

    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.devenv.name
        "awslogs-region"        = data.aws_region.current.name
        "awslogs-stream-prefix" = "nginx"
      }
    }
  }])

  tags = { Name = "cc-nginx-router" }
}

# ---- Nginx ECS Service -------------------------------------------------------
resource "aws_ecs_service" "nginx" {
  name            = "cc-nginx-router"
  cluster         = aws_ecs_cluster.this.id
  task_definition = aws_ecs_task_definition.nginx.arn
  desired_count   = 2

  network_configuration {
    subnets          = var.private_subnet_ids
    security_groups  = [aws_security_group.nginx.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.nginx.arn
    container_name   = "nginx"
    container_port   = 80
  }

  deployment_minimum_healthy_percent = 50
  deployment_maximum_percent         = 200

  depends_on = [aws_lb_listener.nlb_http]
}

# ---- NLB (replaces ALB) -----------------------------------------------------
resource "aws_lb" "nlb" {
  name               = "cc-devenv-nlb"
  internal           = false
  load_balancer_type = "network"
  subnets            = var.public_subnet_ids

  tags = { Name = "cc-devenv-nlb" }
}

resource "aws_lb_target_group" "nginx" {
  name        = "cc-nginx-tg"
  port        = 80
  protocol    = "TCP"
  vpc_id      = var.vpc_id
  target_type = "ip"

  health_check {
    protocol            = "HTTP"
    path                = "/health"
    interval            = 30
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }

  tags = { Name = "cc-nginx-tg" }
}

resource "aws_lb_listener" "nlb_http" {
  load_balancer_arn = aws_lb.nlb.arn
  port              = 80
  protocol          = "TCP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.nginx.arn
  }
}

# ---- CloudFront Distribution ------------------------------------------------
resource "aws_cloudfront_distribution" "this" {
  comment = "CC-on-Bedrock Dev Environment (NLB+Nginx)"
  enabled = true

  origin {
    domain_name = aws_lb.nlb.dns_name
    origin_id   = "devenv-nlb"

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "http-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }

    custom_header {
      name  = "X-Custom-Secret"
      value = var.cloudfront_secret_value
    }
  }

  default_cache_behavior {
    target_origin_id       = "devenv-nlb"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods         = ["GET", "HEAD"]

    cache_policy_id          = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad"
    origin_request_policy_id = "216adef6-5c7f-47e4-b989-5492eafa07d3"
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }

  tags = { Name = "cc-devenv-cloudfront" }
}

# ---- Route 53 Wildcard Record ------------------------------------------------
resource "aws_route53_record" "wildcard" {
  zone_id = var.hosted_zone_id
  name    = "*.${var.dev_subdomain}.${var.domain_name}"
  type    = "A"

  alias {
    name                   = aws_cloudfront_distribution.this.domain_name
    zone_id                = aws_cloudfront_distribution.this.hosted_zone_id
    evaluate_target_health = false
  }
}
