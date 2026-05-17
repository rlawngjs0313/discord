const { handleMessage } = require('../../../src/domains/bot/bot.service');

describe('Bot Message Handler', () => {
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
});
