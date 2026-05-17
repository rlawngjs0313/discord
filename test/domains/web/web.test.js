const request = require('supertest');
const crypto = require('crypto');
const { createServer } = require('../../../src/domains/web/web.service');
const config = require('../../../src/config');

// config 모킹하여 테스트 환경 독립성 확보
jest.mock('../../../src/config', () => {
  const originalConfig = jest.requireActual('../../../src/config');
  return {
    ...originalConfig,
    web: {
      ...originalConfig.web,
      cookieSecret: 'test-secret-key-for-unit-tests'
    }
  };
});

describe('Web Server API', () => {
  let app;
  let mockClient;

  /**
   * express에서 사용하는 서명된 쿠키 생성 (s:value.signature)
   */
  const signCookie = (val, secret) => {
    const signature = crypto
      .createHmac('sha256', secret)
      .update(val)
      .digest('base64')
      .replace(/\=+$/, '');
    return 's:' + val + '.' + signature;
  };

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

  test('GET /invite should redirect with state', async () => {
    const response = await request(app).get('/invite');
    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toContain('state=');
    expect(response.headers['set-cookie'][0]).toContain('oauth_state=');
  });

  test('GET /oauth/callback should return 403 if state mismatch', async () => {
    const response = await request(app).get('/oauth/callback?code=mock&state=wrong');
    expect(response.statusCode).toBe(403);
    expect(response.text).toContain('보안 토큰(state)이 일치하지 않습니다');
  });

  test('GET /oauth/callback should return success message (ModelAndView)', async () => {
    const state = 'valid-state';
    const signedCookie = signCookie(state, config.web.cookieSecret);
    
    // 1. 토큰 교환 모킹
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ access_token: 'mock_token' }),
    });

    // 2. 사용자 정보 조회 모킹
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ username: 'TestUser', discriminator: '1234' }),
    });

    const response = await request(app)
      .get(`/oauth/callback?code=mock_code&state=${state}`)
      .set('Cookie', [`oauth_state=${signedCookie}`]);
    
    expect(response.statusCode).toBe(200);
    expect(response.text).toContain('TestUser#1234');
  });
});
