output "s3_bucket" {
  value = module.app.s3_bucket
}

output "cf_distribution_id" {
  value = module.app.cf_distribution_id
}

output "url" {
  value = module.app.url
}

output "sqs_queue_url" {
  value = module.app.sqs_queue_url
}