const { Client, GatewayIntentBits } = require('discord.js');
const { handleMessage } = require('../index.js');

describe('Discord Bot Basic Configuration', () => {
  test('Bot client should be initialized with correct intents', () => {
    const client = new Client({
      intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
    });
    expect(client).toBeDefined();
    expect(client.options.intents.toArray()).toContain('Guilds');
  });
});

describe('Message Handler', () => {
  test('should reply with "Pong!" when message is "!ping"', () => {
    const mockReply = jest.fn();
    const mockMessage = {
      content: '!ping',
      author: { bot: false },
      reply: mockReply,
    };

    handleMessage(mockMessage);

    expect(mockReply).toHaveBeenCalledWith('Pong!');
  });

  test('should not reply when message is from a bot', () => {
    const mockReply = jest.fn();
    const mockMessage = {
      content: '!ping',
      author: { bot: true },
      reply: mockReply,
    };

    handleMessage(mockMessage);

    expect(mockReply).not.toHaveBeenCalled();
  });

  test('should not reply when message is not "!ping"', () => {
    const mockReply = jest.fn();
    const mockMessage = {
      content: 'hello',
      author: { bot: false },
      reply: mockReply,
    };

    handleMessage(mockMessage);

    expect(mockReply).not.toHaveBeenCalled();
  });
});
