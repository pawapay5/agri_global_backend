variable "env" {
  type        = string
  description = "Environment name (dev | staging | prod)"
}
variable "region" {
  type    = string
  default = "eu-west-1"
}
variable "vpc_cidr" {
  type    = string
  default = "10.40.0.0/16"
}
variable "node_instance_type" {
  type    = string
  default = "m6i.large"
}
variable "redis_node_type" {
  type    = string
  default = "cache.t4g.small"
}
variable "db_milli_cpu" {
  type    = number
  default = 2000
}
variable "db_memory_gb" {
  type    = number
  default = 8
}
variable "timescale_project_id" { type = string }
variable "timescale_access_key" {
  type      = string
  sensitive = true
}
variable "timescale_secret_key" {
  type      = string
  sensitive = true
}

output "eks_cluster_name" { value = module.eks.cluster_name }
output "redis_endpoint" { value = aws_elasticache_replication_group.redis.primary_endpoint_address }
output "db_hostname" { value = timescale_service.db.hostname }
output "app_secret_arn" { value = aws_secretsmanager_secret.app.arn }
