const { sendScheduledGif } = require('../../../src/domains/scheduler/scheduler.service');

describe('Scheduler Service', () => {
  test('sendScheduledGif should find channel by name and send GIF', async () => {
    const mockSend = jest.fn().mockResolvedValue(null);
    const mockChannel = { 
      name: '깡-통', 
      isTextBased: () => true,
      send: mockSend 
    };
    const mockClient = {
      channels: {
        cache: {
            find: jest.fn().mockReturnValue(mockChannel)
        }
      },
    };

    await sendScheduledGif(mockClient, '깡-통', 'http://mock-gif.url');

    expect(mockSend).toHaveBeenCalledWith('http://mock-gif.url');
  });

  test('sendScheduledGif should log error if channel not found', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const mockClient = {
      channels: {
        cache: {
            find: jest.fn().mockReturnValue(null)
        }
      },
    };

    await sendScheduledGif(mockClient, '깡-통', 'http://mock-gif.url');

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('채널을 찾을 수 없거나 메시지 전송이 불가능한 채널입니다')
    );
    consoleSpy.mockRestore();
  });
});
