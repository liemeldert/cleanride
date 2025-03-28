FROM python:3.13-slim

WORKDIR /app

# Install dependencies
COPY ./requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the parser code
COPY . .

CMD ["python", "main.py"]