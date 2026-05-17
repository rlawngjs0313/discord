const request = require('supertest');
const { client, handleMessage, app, sendScheduledGif } = require('../index.js');

describe('Discord Bot Basic Configuration', () => {
  test('Bot client should be initialized with correct intents', () => {
    expect(client).toBeDefined();
    const intents = client.options.intents.toArray();
    expect(intents).toContain('Guilds');
    expect(intents).toContain('GuildMessages');
    expect(intents).toContain('MessageContent');
  });
});

describe('Message Handler', () => {
  test('should reply with "Pong!" when message is "!ping"', async () => {
    const mockReply = jest.fn().mockResolvedValue(null);
    const mockMessage = {
      content: '!ping',
      author: { bot: false },
      reply: mockReply,
    };

    await handleMessage(mockMessage);

    expect(mockReply).toHaveBeenCalledWith('Pong!');
  });

  test('should not reply when message is from a bot', async () => {
    const mockReply = jest.fn().mockResolvedValue(null);
    const mockMessage = {
      content: '!ping',
      author: { bot: true },
      reply: mockReply,
    };

    await handleMessage(mockMessage);

    expect(mockReply).not.toHaveBeenCalled();
  });

  test('should not reply when message is not "!ping"', async () => {
    const mockReply = jest.fn().mockResolvedValue(null);
    const mockMessage = {
      content: 'hello',
      author: { bot: false },
      reply: mockReply,
    };

    await handleMessage(mockMessage);

    expect(mockReply).not.toHaveBeenCalled();
  });
});

describe('Web Server API', () => {
  beforeEach(() => {
    jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('GET / should return server status', async () => {
    const response = await request(app).get('/');
    expect(response.statusCode).toBe(200);
    expect(response.text).toContain('Discord Bot Server is');
  });

  test('GET /oauth/callback should return 400 if code is missing', async () => {
    const response = await request(app).get('/oauth/callback');
    expect(response.statusCode).toBe(400);
    expect(response.text).toContain('code가 누락되었습니다');
  });

  test('GET /oauth/callback should return success message with user data (Old System)', async () => {
    // 1. 토큰 교환 모킹
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ access_token: 'mock_token' }),
    });

    // 2. 사용자 정보 조회 모킹 (기존 시스템: #1234 존재)
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ username: 'TestUser', discriminator: '1234' }),
    });

    const response = await request(app).get('/oauth/callback?code=mock_code');
    
    expect(response.statusCode).toBe(200);
    expect(response.text).toContain('TestUser#1234');
  });

  test('GET /oauth/callback should return success message with user data (New System - Pomelo)', async () => {
    // 1. 토큰 교환 모킹
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ access_token: 'mock_token' }),
    });

    // 2. 사용자 정보 조회 모킹 (신규 시스템: discriminator '0')
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ username: 'newuser', discriminator: '0' }),
    });

    const response = await request(app).get('/oauth/callback?code=mock_code');
    
    expect(response.statusCode).toBe(200);
    expect(response.text).toContain('newuser');
    expect(response.text).not.toContain('newuser#');
  });

  test('GET /oauth/callback should return success message with escaped username', async () => {
    // 1. 토큰 교환 모킹
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ access_token: 'mock_token' }),
    });

    // 2. 사용자 정보 조회 모킹 (악성 스크립트 포함)
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ username: '<script>alert(1)</script>', discriminator: '0' }),
    });

    const response = await request(app).get('/oauth/callback?code=mock_code');
    
    expect(response.statusCode).toBe(200);
    expect(response.text).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(response.text).not.toContain('<script>');
  });

  test('GET /oauth/callback should return 500 if token exchange fails', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'invalid_grant' }),
    });

    const response = await request(app).get('/oauth/callback?code=bad_code');
    
    expect(response.statusCode).toBe(500);
    expect(response.text).toContain('인증 토큰을 가져오는 데 실패했습니다');
  });
});

describe('Scheduled GIF Feature', () => {
  test('sendScheduledGif should fetch channel and send GIF', async () => {
    const mockSend = jest.fn().mockResolvedValue(null);
    const mockChannel = { send: mockSend };
    const mockClient = {
      channels: {
        fetch: jest.fn().mockResolvedValue(mockChannel),
      },
    };
    const channelId = '123456789';

    await sendScheduledGif(mockClient, channelId);

    expect(mockClient.channels.fetch).toHaveBeenCalledWith(channelId);
    expect(mockSend).toHaveBeenCalledWith(expect.stringContaining('giphy.com/gifs/0357-1557'));
  });

  test('sendScheduledGif should log error if channel not found', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const mockClient = {
      channels: {
        fetch: jest.fn().mockResolvedValue(null),
      },
    };

    await sendScheduledGif(mockClient, 'invalid_id');

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('채널을 찾을 수 없습니다'),
      'invalid_id'
    );
    consoleSpy.mockRestore();
  });
});
