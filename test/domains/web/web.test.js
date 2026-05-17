const request = require('supertest');
const { createServer } = require('../../../src/domains/web/web.service');

describe('Web Server API', () => {
  let app;
  let mockClient;

  beforeEach(() => {
    jest.spyOn(global, 'fetch');
    mockClient = { isReady: jest.fn().mockReturnValue(true) };
    app = createServer(mockClient);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('GET / should return server status', async () => {
    const response = await request(app).get('/');
    expect(response.statusCode).toBe(200);
    expect(response.text).toContain('Discord Bot Server is Online');
  });

  test('GET /oauth/callback should return 400 if code is missing', async () => {
    const response = await request(app).get('/oauth/callback');
    expect(response.statusCode).toBe(400);
    expect(response.text).toContain('code가 누락되었습니다');
  });

  test('GET /oauth/callback should return success message with escaped username', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ access_token: 'mock_token' }),
    });

    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ username: '<script>alert(1)</script>', discriminator: '0' }),
    });

    const response = await request(app).get('/oauth/callback?code=mock_code');
    
    expect(response.statusCode).toBe(200);
    expect(response.text).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });
});
