output "s3_bucket" {
  value = module.react_lambda.s3_bucket
}

output "cf_distribution_id" {
  value = module.react_lambda.cf_distribution_id
}

output "url" {
  value = module.react_lambda.url
}

output "sqs_queue_url" {
  value = aws_sqs_queue.vote_queue.url
}