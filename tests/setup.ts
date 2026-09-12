process.env.NODE_ENV = 'test';
process.env.APP_ENV = 'development';
process.env.REDIS_URL = 'redis://127.0.0.1:6379';
process.env.JWT_SECRET = 'test-only-jwt-secret-with-at-least-32-characters';
process.env.REFRESH_ROTATION_ENCRYPTION_KEY = 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY';
process.env.TURSO_DATABASE_URL = 'http://127.0.0.1:8080';
process.env.TURSO_AUTH_TOKEN = 'test-only-turso-token';
delete process.env.GROQ_API_KEY;
