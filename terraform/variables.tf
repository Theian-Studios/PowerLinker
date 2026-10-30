variable "env" {
  type        = string
  description = "The branch being deployed"
}

variable "image_tag" {
  type        = string
  description = "The image tag for the Docker image (the timestamp)."
}

variable "discord_bot_token" {
  type        = string
  description = "The Discord bot token for sending error reports."
  default     = ""
}

variable "discord_channel_id" {
  type        = string
  description = "The Discord channel ID for sending error reports."
  default     = ""
}
