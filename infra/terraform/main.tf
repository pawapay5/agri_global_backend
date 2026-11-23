# AgriPrice platform infrastructure (AWS + Timescale Cloud).
# RDS doesn't ship TimescaleDB, so Postgres 16 + TimescaleDB + PostGIS runs on Timescale Cloud,
# peered into the VPC. Everything else is AWS-native.

terraform {
  required_version = ">= 1.7"
  required_providers {
    aws       = { source = "hashicorp/aws", version = "~> 5.60" }
    timescale = { source = "timescale/timescale", version = "~> 1.10" }
    random    = { source = "hashicorp/random", version = "~> 3.6" }
  }
  backend "s3" {} # configured per environment: -backend-config=envs/<env>.backend.hcl
}

provider "aws" {
  region = var.region
  default_tags { tags = { project = "agriprice", env = var.env } }
}

provider "timescale" {
  project_id = var.timescale_project_id
  access_key = var.timescale_access_key
  secret_key = var.timescale_secret_key
}

locals { name = "agriprice-${var.env}" }

module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "~> 5.13"
  name    = local.name
  cidr    = var.vpc_cidr
  azs     = slice(data.aws_availability_zones.available.names, 0, 3)
  private_subnets    = [for i in range(3) : cidrsubnet(var.vpc_cidr, 4, i)]
  public_subnets     = [for i in range(3) : cidrsubnet(var.vpc_cidr, 8, 48 + i)]
  enable_nat_gateway = true
  single_nat_gateway = var.env != "prod"
}

data "aws_availability_zones" "available" {}

module "eks" {
  source          = "terraform-aws-modules/eks/aws"
  version         = "~> 20.24"
  cluster_name    = local.name
  cluster_version = "1.31"
  vpc_id          = module.vpc.vpc_id
  subnet_ids      = module.vpc.private_subnets
  cluster_endpoint_public_access = true
  enable_cluster_creator_admin_permissions = true
  eks_managed_node_groups = {
    general = { instance_types = [var.node_instance_type], min_size = 2, max_size = 8, desired_size = 3 }
    ml      = { instance_types = ["c6i.2xlarge"], min_size = 0, max_size = 2, desired_size = 0,
                labels = { workload = "ml" }, taints = [{ key = "workload", value = "ml", effect = "NO_SCHEDULE" }] }
  }
}

# ── Redis 7 (cache, rate limits, OTP, BullMQ) ──
resource "aws_elasticache_subnet_group" "redis" {
  name       = local.name
  subnet_ids = module.vpc.private_subnets
}

resource "aws_security_group" "redis" {
  name   = "${local.name}-redis"
  vpc_id = module.vpc.vpc_id
  ingress {
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = [module.eks.node_security_group_id]
  }
}

resource "random_password" "redis" {
  length  = 48
  special = false
}

resource "aws_elasticache_replication_group" "redis" {
  replication_group_id       = local.name
  description                = "AgriPrice Redis"
  engine                     = "redis"
  engine_version             = "7.1"
  node_type                  = var.redis_node_type
  num_cache_clusters         = var.env == "prod" ? 2 : 1
  automatic_failover_enabled = var.env == "prod"
  subnet_group_name          = aws_elasticache_subnet_group.redis.name
  security_group_ids         = [aws_security_group.redis.id]
  at_rest_encryption_enabled = true
  transit_encryption_enabled = true
  auth_token                 = random_password.redis.result
  # BullMQ requires noeviction.
  parameter_group_name = aws_elasticache_parameter_group.redis.name
}

resource "aws_elasticache_parameter_group" "redis" {
  name   = "${local.name}-redis7"
  family = "redis7"
  parameter {
    name  = "maxmemory-policy"
    value = "noeviction"
  }
}

# ── Postgres 16 + TimescaleDB + PostGIS ──
resource "timescale_service" "db" {
  name        = local.name
  milli_cpu   = var.db_milli_cpu
  memory_gb   = var.db_memory_gb
  region_code = var.region
  enable_ha_replica = var.env == "prod"
}

# ── Object storage ──
resource "aws_s3_bucket" "this" {
  for_each = toset(["reports", "images", "mlflow"])
  bucket   = "${local.name}-${each.key}"
}

resource "aws_s3_bucket_public_access_block" "this" {
  for_each                = aws_s3_bucket.this
  bucket                  = each.value.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "this" {
  for_each = aws_s3_bucket.this
  bucket   = each.value.id
  rule {
    apply_server_side_encryption_by_default { sse_algorithm = "AES256" }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "reports" {
  bucket = aws_s3_bucket.this["reports"].id
  rule {
    id     = "expire-generated-reports"
    status = "Enabled"
    filter {}
    expiration { days = 90 }
  }
}

# ── Secrets (values set out of band, consumed via External Secrets Operator) ──
resource "aws_secretsmanager_secret" "app" {
  name = "${local.name}/app"
}

resource "aws_secretsmanager_secret_version" "infra" {
  secret_id = aws_secretsmanager_secret.app.id
  secret_string = jsonencode({
    DATABASE_URL = "postgres://tsdbadmin:${timescale_service.db.password}@${timescale_service.db.hostname}:${timescale_service.db.port}/tsdb?sslmode=require"
    REDIS_URL    = "rediss://:${random_password.redis.result}@${aws_elasticache_replication_group.redis.primary_endpoint_address}:6379"
  })
  lifecycle { ignore_changes = [secret_string] }
}
