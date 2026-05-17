const request = require('supertest');
const { client, handleMessage, app } = require('../index.js');

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
  test('GET / should return server status', async () => {
    const response = await request(app).get('/');
    expect(response.statusCode).toBe(200);
    expect(response.text).toContain('Discord Bot Server is');
  });

  test('GET /oauth/callback should return success message', async () => {
    const response = await request(app).get('/oauth/callback');
    expect(response.statusCode).toBe(200);
    expect(response.text).toContain('봇 초대가 성공적으로 완료되었습니다');
  });
});
