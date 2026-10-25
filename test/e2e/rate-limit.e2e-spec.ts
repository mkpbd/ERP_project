import request from 'supertest';
import type { App } from 'supertest/types.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../support/test-app.js';

let t: TestApp;
let http: App;

beforeAll(async () => {
  t = await createTestApp({ AUTH_RATE_LIMIT_LIMIT: '3', RATE_LIMIT_LIMIT: '1000' });
  http = t.app.getHttpServer();
});
afterAll(() => t.app.close());

describe('rate limiting', () => {
  it('throttles credential endpoints per client with problem details', async () => {
    const attempt = () =>
      request(http).post('/api/v1/auth/login').send({ identifier: 'brute@example.com', password: 'guess guess guess' });
    for (let i = 0; i < 3; i++) expect((await attempt()).status).toBe(401);
    const limited = await attempt().expect(429);
    expect(limited.body).toMatchObject({ code: 'rate_limited', status: 429 });
    expect(limited.headers['retry-after-auth']).toBeDefined();
  });

  it('does not apply the strict bucket to ordinary routes', async () => {
    for (let i = 0; i < 5; i++) await request(http).get('/api/v1/health/live').expect(200);
    for (let i = 0; i < 5; i++) await request(http).get('/api/v1/users/me').expect(401);
  });
});
