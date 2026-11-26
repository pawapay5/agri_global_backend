# Scheduler for the data pipelines (see scheduler.py). Light image: training runs in the `ml` service, so the
# heavy ML libraries aren't installed here.
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 \
    PREFECT_HOME=/tmp/prefect PREFECT_LOGGING_LEVEL=INFO
WORKDIR /app
RUN pip install "prefect>=3.0,<4" "httpx>=0.27" "psycopg[binary]>=3.2" "pandas>=2.2"
COPY flows ./flows
COPY scheduler.py ./
RUN useradd --uid 10001 --create-home app && mkdir -p /tmp/prefect && chown app /tmp/prefect
USER app
CMD ["python", "scheduler.py"]
