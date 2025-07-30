# Use a minimal and secure Python base image
FROM python:3.11-slim

# Set working directory inside the container
WORKDIR /app

# Install system dependencies (optional: if your code needs them)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    gcc \
    && rm -rf /var/lib/apt/lists/*

# Copy only requirements first for better caching
COPY requirements.txt .

# Install Python dependencies without cache
RUN pip install --no-cache-dir -r requirements.txt

# Copy the full project
COPY . .

# Optional: set environment variable to prevent Python from buffering stdout
ENV PYTHONUNBUFFERED=1

# Optional: use non-root user (create one and switch to it)
# RUN useradd -m appuser
# USER appuser

# Expose the FastAPI port
EXPOSE 8000

# Set the default command to run the FastAPI server
CMD ["uvicorn", "api:app", "--host", "0.0.0.0", "--port", "8000"]
