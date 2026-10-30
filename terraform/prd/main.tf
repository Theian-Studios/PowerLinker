terraform {
  required_version = ">=1.4.5"

  backend "s3" {
    bucket         = "terraform-state-storage-112065100358"
    dynamodb_table = "terraform-state-lock-112065100358"
    key            = "ReactLambdaTemplate.tfstate" // Replace 'ReactLambdaTemplate' with the project name
    region         = "us-west-2"
  }
  required_providers {
    aws = {
      source = "hashicorp/aws"
    }
  }
}

provider "aws" {
  region = "us-west-2"
}

module "app" {
  source             = "../"
  env                = "prd"
  image_tag          = var.image_tag
  discord_bot_token  = var.discord_bot_token
  discord_channel_id = var.discord_channel_id
}
