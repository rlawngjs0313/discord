import { Message } from 'discord.js';
import { handleMessage } from '../../../src/domains/bot/bot.service';

describe('Bot Message Handler', () => {
  test('should reply with "Pong!" and log message when message is "!ping"', async () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const mockReply = jest.fn().mockResolvedValue(null);
    const mockMessage = {
      content: '!ping',
      author: { bot: false },
      reply: mockReply,
    } as unknown as Message;

    await handleMessage(mockMessage);

    expect(mockReply).toHaveBeenCalledWith('Pong!');
    expect(consoleSpy).toHaveBeenCalledWith('!ping 감지: Pong 메시지 전송!');
    consoleSpy.mockRestore();
  });

  test('should not reply when message is from a bot', async () => {
    const mockReply = jest.fn().mockResolvedValue(null);
    const mockMessage = {
      content: '!ping',
      author: { bot: true },
      reply: mockReply,
    } as unknown as Message;

    await handleMessage(mockMessage);

    expect(mockReply).not.toHaveBeenCalled();
  });
});
