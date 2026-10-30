locals {
  project_name = "PowerLinker"
  app_name     = "rllpowerlinker"
}

resource "aws_ecr_repository" "ecr_repo" {
  name = "${local.app_name}-repo"

  image_scanning_configuration {
    scan_on_push = true
  }
}

module "react_lambda" {
  source = "github.com/byuawsfhtl/terraform-react-lambda?ref=prd"

  project_name = local.project_name
  app_name     = local.app_name
  env          = var.env

  ecr_repo  = aws_ecr_repository.ecr_repo
  image_tag = var.image_tag

  lambda_environment_variables = {
    "ENV"                = var.env
    "DISCORD_BOT_TOKEN"  = var.discord_bot_token
    "DISCORD_CHANNEL_ID" = var.discord_channel_id
  }

  lambda_endpoint_definitions = [
    {
      path_part = "hints"
      method_definitions = [
        {
          http_method = "GET"
          command     = ["backend.src.main.get_hints_handler"]
          timeout     = 900  # Optional, value is in seconds
          memory_size = 1024 # Optional, value is in megabytes
        },
        {
          http_method = "PUT"
          command     = ["backend.src.main.submit_votes_handler"]
          timeout     = 900
          memory_size = 1024
        }
      ]
    },
    {
      path_part = "session-invalidate"
      method_definitions = [
        {
          http_method = "POST"
          command     = ["backend.src.main.session_handler"]
          timeout     = 900  # Optional, value is in seconds
          memory_size = 1024 # Optional, value is in megabytes
        }
      ]
    }
  ]

  lambda_policies = [
    aws_iam_policy.power_linker_dynamo_policy.arn,
    aws_iam_policy.power_linker_sqs_policy.arn,
    aws_iam_policy.power_linker_param_policy.arn,
    aws_iam_policy.power_linker_secrets_policy.arn,
  ]
}

# QUEUE AND TRIGGER

resource "aws_sqs_queue" "vote_queue" {
  name                       = "PowerLinkerVoteQueue"
  delay_seconds              = 0
  max_message_size           = 1024
  visibility_timeout_seconds = 120
  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.vote_deadletter_queue.arn
    maxReceiveCount     = 5
  })
}

resource "aws_sqs_queue" "vote_deadletter_queue" {
  name = "PowerLinkerVoteDeadletterQueue"
}

data "aws_iam_role" "lambda_execution" {
  name = local.app_name

  depends_on = [module.react_lambda]
}

resource "aws_cloudwatch_log_group" "vote_processor" {
  name              = "/aws/lambda/${local.app_name}-vote-processor"
  retention_in_days = 14
}

resource "aws_lambda_function" "vote_processor" {
  function_name = "${local.app_name}-vote-processor"
  role          = data.aws_iam_role.lambda_execution.arn
  package_type  = "Image"
  image_uri     = "${aws_ecr_repository.ecr_repo.repository_url}:${local.app_name}-${var.image_tag}"

  image_config {
    command = ["backend.src.main.process_hint_vote_handler"]
  }

  timeout     = 120
  memory_size = 1024

  environment {
    variables = {
      ENV          = var.env
      ALLOWED_ARNS = jsonencode([aws_sqs_queue.vote_queue.arn])
    }
  }

  depends_on = [
    module.react_lambda,
    aws_cloudwatch_log_group.vote_processor,
  ]
}

resource "aws_lambda_event_source_mapping" "sqs_lambda_trigger" {
  event_source_arn        = aws_sqs_queue.vote_queue.arn
  function_name           = aws_lambda_function.vote_processor.arn
  batch_size              = 10
  enabled                 = true
  function_response_types = ["ReportBatchItemFailures"]
}

# DYNAMODB TABLES

resource "aws_dynamodb_table" "power_linker_auto" {
  name                        = "PowerLinkerAuto"
  billing_mode                = "PAY_PER_REQUEST"
  hash_key                    = "url"
  range_key                   = "insert-time"
  deletion_protection_enabled = var.env == "prd" ? true : false

  attribute {
    name = "url"
    type = "S"
  }

  attribute {
    name = "hint-type"
    type = "S"
  }

  attribute {
    name = "insert-time"
    type = "N"
  }

  global_secondary_index {
    name            = "hint-type-insert-time-index"
    hash_key        = "hint-type"
    range_key       = "insert-time"
    projection_type = "ALL"
  }
}

resource "aws_dynamodb_table" "power_linker_invalid_sid" {
  name                        = "PowerLinkerInvalidSid"
  billing_mode                = "PAY_PER_REQUEST"
  hash_key                    = "sid"
  range_key                   = "expiry"
  deletion_protection_enabled = var.env == "prd" ? true : false

  ttl {
    attribute_name = "expiry"
    enabled        = true
  }

  attribute {
    name = "sid"
    type = "S"
  }

  attribute {
    name = "expiry"
    type = "N"
  }

}

# IAM POLICIES

data "aws_ssm_parameters_by_path" "tree_tapper_params" {
  path = "/tree-tapper/"
}

data "aws_ssm_parameters_by_path" "growth_spurt_params" {
  path      = "/growth-spurt/"
  recursive = true
}

data "aws_secretsmanager_secret" "growth_spurt_auth" {
  name = "GrowthSpurtAPI/auth/powerlinker"
}

data "aws_dynamodb_table" "growth_spurt_hints" {
  name = "GrowthSpurtHints"
}

resource "aws_iam_policy" "power_linker_param_policy" {
  name        = "power_linker_param_policy"
  path        = "/"
  description = "Power Linker access to its SSM parameters"

  policy = jsonencode({
    "Version" : "2012-10-17",
    "Statement" : [
      {
        "Effect" : "Allow",
        "Action" : [
          "ssm:GetParameter",
          "ssm:GetParameters"
        ],
        "Resource" : concat(
          [for arn in data.aws_ssm_parameters_by_path.tree_tapper_params.arns : arn],
          [for arn in data.aws_ssm_parameters_by_path.growth_spurt_params.arns : arn]
        )
      }
    ]
  })
}

resource "aws_iam_policy" "power_linker_dynamo_policy" {
  name        = "power_linker_dynamo_policy"
  path        = "/"
  description = "Power Linker access to all of it's dynamo db tables"

  policy = jsonencode({
    "Version" : "2012-10-17",
    "Statement" : [
      {
        "Effect" : "Allow",
        "Action" : [
          "dynamodb:BatchGet*",
          "dynamodb:DescribeStream",
          "dynamodb:DescribeTable",
          "dynamodb:Get*",
          "dynamodb:Query",
          "dynamodb:Scan",
          "dynamodb:BatchWrite*",
          "dynamodb:Update*",
          "dynamodb:PutItem",
          "dynamodb:DeleteItem"
        ],
        "Resource" : [
          "${aws_dynamodb_table.power_linker_auto.arn}",
          "${aws_dynamodb_table.power_linker_auto.arn}/index/*",
          "${aws_dynamodb_table.power_linker_invalid_sid.arn}",
          "${aws_dynamodb_table.power_linker_invalid_sid.arn}/index/*",
          "${data.aws_dynamodb_table.growth_spurt_hints.arn}",
          "${data.aws_dynamodb_table.growth_spurt_hints.arn}/index/*"
        ]
      }
    ]
  })
}

resource "aws_iam_policy" "power_linker_secrets_policy" {
  name        = "power_linker_secrets_policy"
  path        = "/"
  description = "Power Linker access to Growth Spurt API secret"

  policy = jsonencode({
    "Version" : "2012-10-17",
    "Statement" : [
      {
        "Effect" : "Allow",
        "Action" : [
          "secretsmanager:GetSecretValue"
        ],
        "Resource" : data.aws_secretsmanager_secret.growth_spurt_auth.arn
      }
    ]
  })
}

resource "aws_iam_policy" "power_linker_sqs_policy" {
  name        = "power_linker_sqs_policy"
  path        = "/"
  description = "Power Linker access to its SQS queues"

  policy = jsonencode({
    "Version" : "2012-10-17",
    "Statement" : [
      {
        "Effect" : "Allow",
        "Action" : [
          "sqs:SendMessage",
          "sqs:ReceiveMessage",
          "sqs:DeleteMessage",
          "sqs:GetQueueAttributes",
          "sqs:GetQueueUrl"
        ],
        "Resource" : [
          "${aws_sqs_queue.vote_queue.arn}",
          "${aws_sqs_queue.vote_deadletter_queue.arn}"
        ]
      }
    ]
  })
}