from setuptools import setup, find_packages

setup(
    name="lobster-report-backend",
    version="1.0.0",
    packages=find_packages(),
    install_requires=[
        "fastapi==0.104.1",
        "uvicorn[standard]==0.24.0",
        "pydantic==2.5.0",
        "sqlalchemy==2.0.23",
        "psycopg2-binary==2.9.9",
        "python-jose[cryptography]==3.3.0",
        "passlib[bcrypt]==1.7.4",
        "python-multipart==0.0.6",
        "python-dotenv==1.0.0",
        "celery==5.3.4",
        "redis==5.0.1",
        "requests==2.31.0",
        "beautifulsoup4==4.12.2",
        "lxml==4.9.3",
        "feedparser==6.0.10",
        "scrapy==2.11.0",
        "playwright==1.40.0",
        "openai==1.3.5",
        "tiktoken==0.5.2",
    ],
)
