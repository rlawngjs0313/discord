const { GatewayIntentBits } = require('discord.js');
const { client, handleMessage } = require('../index.js');

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
