FROM python:latest

WORKDIR /app
ADD ./requirements.txt /app/requirements.txt
RUN pip install -r requirements.txt
ADD main.py /app/main.py
RUN mkdir -p /app/db

CMD ["python", "main.py"]