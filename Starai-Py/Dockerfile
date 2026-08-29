FROM python:3.11-alpine

WORKDIR /app

# Set environment variables
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

# Install system dependencies required for telethon/aiohttp
RUN apk add --no-cache gcc musl-dev libffi-dev

# Copy and install python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Remove build dependencies to save massive space/RAM
RUN apk del gcc musl-dev libffi-dev

# Copy application files
COPY . .

# Run the userbot bridge
CMD ["python", "main.py"]
