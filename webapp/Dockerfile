# One image, runnable anywhere that takes a container: Render, Hugging Face
# Spaces, Fly, a laptop. Nothing host-specific inside it.
FROM python:3.12-slim

# Bytecode written at build time rather than on every cold start, and no .pyc
# clutter in the layer.
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /srv

# The engine first: it changes far less often than the app, so this layer stays
# cached across most rebuilds.
COPY pytailor /srv/pytailor
RUN pip install --no-cache-dir /srv/pytailor

COPY webapp /srv/webapp
RUN pip install --no-cache-dir "/srv/webapp[postgres]"

WORKDIR /srv/webapp

# Hugging Face Spaces runs as a non-root user and mounts nothing writable at /,
# so the SQLite default needs somewhere it can actually write.
RUN mkdir -p /srv/data && chmod 777 /srv/data
ENV DATABASE_URL=sqlite:////srv/data/resume-tailor.db

# Hosts inject PORT; 7860 is what Spaces expects when they do not.
ENV PORT=7860
EXPOSE 7860

# Shell form so ${PORT} is expanded at runtime rather than baked in.
CMD uvicorn app.main:app --host 0.0.0.0 --port ${PORT}
