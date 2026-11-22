FROM python:3.12-slim

# Install system dependencies (FFmpeg + curl)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Set up non-root user (Standard for Hugging Face Spaces & Linux security)
RUN useradd -m -u 1000 user
USER user
ENV HOME=/home/user \
    PATH=/home/user/.local/bin:$PATH \
    PYTHONUNBUFFERED=1

WORKDIR /home/user/app

# Install Python requirements
COPY --chown=user:user requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application source
COPY --chown=user:user . .

# Ensure downloads directory exists with correct permissions
RUN mkdir -p downloads

# Port 7860 is default for Hugging Face Spaces; fallback to $PORT or 8000
ENV PORT=7860
EXPOSE 7860 8000

CMD ["sh", "-c", "uvicorn app:app --host 0.0.0.0 --port ${PORT:-7860}"]
