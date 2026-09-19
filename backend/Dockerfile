FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PORT=8080

WORKDIR /app

RUN addgroup --system stratexec && adduser --system --ingroup stratexec stratexec

COPY pyproject.toml ./
COPY src ./src
RUN pip install .

USER stratexec
EXPOSE 8080

CMD ["sh", "-c", "python -m uvicorn stratexec.api.main:app --host 0.0.0.0 --port ${PORT:-8080}"]
