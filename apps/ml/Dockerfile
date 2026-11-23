FROM python:3.12-slim AS base
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY pyproject.toml ./
COPY agriprice_ml ./agriprice_ml
RUN pip install .
RUN useradd --uid 10001 --create-home app
USER app
EXPOSE 8001
CMD ["uvicorn", "agriprice_ml.app:app", "--host", "0.0.0.0", "--port", "8001"]
