FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY forecasting.py main.py ./
RUN useradd --system --uid 10001 app
USER app
EXPOSE 8001
HEALTHCHECK CMD python -c "import urllib.request;urllib.request.urlopen('http://127.0.0.1:8001/health')"
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8001"]
