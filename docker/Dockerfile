# For more information, please refer to https://aka.ms/vscode-docker-python
FROM public.ecr.aws/lambda/python:3.13

ARG RLL_BOT_PA_TOKEN
ENV RLL_BOT_PA_TOKEN=${RLL_BOT_PA_TOKEN}
ARG ENV
ENV ENV=${ENV}
# Keeps Python from generating .pyc files in the container
ENV PYTHONDONTWRITEBYTECODE=1

# Turns off buffering for easier container logging
ENV PYTHONUNBUFFERED=1

ENV AWS_ACCESS_KEY_ID=""
ENV AWS_SECRET_ACCESS_KEY=""
ENV AWS_SESSION_TOKEN=""
ENV ALLOWED_ARNS='[\"test_arn\"]'

# COPY requirements.txt .
COPY /backend/requirements.txt .

# WORKDIR /backend/lambda/view
# Install git
# RUN dnf update -y
RUN dnf install -y git 
RUN dnf clean all 

# Install pip requirements
COPY backend ${LAMBDA_TASK_ROOT}/backend
RUN sed "s|https://github.com/byuawsfhtl/|https://x-access-token:${RLL_BOT_PA_TOKEN}@github.com/byuawsfhtl/|g" requirements.txt > requirements_auth.txt
RUN python -m pip install -r requirements_auth.txt

# Creates a non-root user with an explicit UID and adds permission to access the /app folder
# For more info, please refer to https://aka.ms/vscode-docker-python-configure-containers
# RUN adduser -u 5678 --disabled-password --gecos "" appuser && chown -R appuser /backend
# USER appuser

EXPOSE 9000

# During debugging, this entry point will be overridden. For more information, please refer to https://aka.ms/vscode-docker-python-debug
# ENTRYPOINT [ "/usr/local/bin/python", "-m", "awslambdaric" ]
CMD ["backend/awsLambda/views/main.handle_test"]
