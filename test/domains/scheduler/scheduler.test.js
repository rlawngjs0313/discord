const { sendScheduledGif } = require('../../../src/domains/scheduler/scheduler.service');

describe('Scheduler Service', () => {
  test('sendScheduledGif should find channel by ID and send GIF', async () => {
    const mockSend = jest.fn().mockResolvedValue(null);
    const mockChannel = { 
      isTextBased: () => true,
      send: mockSend 
    };
    const mockClient = {
      channels: {
        fetch: jest.fn().mockResolvedValue(mockChannel)
      },
    };

    await sendScheduledGif(mockClient, { channelId: '123', gifUrl: 'http://mock.url' });

    expect(mockClient.channels.fetch).toHaveBeenCalledWith('123');
    expect(mockSend).toHaveBeenCalledWith('http://mock.url');
  });

  test('sendScheduledGif should find channel by name if ID missing', async () => {
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

    await sendScheduledGif(mockClient, { channelName: '깡-통', gifUrl: 'http://mock.url' });

    expect(mockSend).toHaveBeenCalledWith('http://mock.url');
  });

  test('sendScheduledGif should log error if channel not found', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const mockClient = {
      channels: {
        fetch: jest.fn().mockResolvedValue(null)
      },
    };

    await sendScheduledGif(mockClient, { channelId: '999', gifUrl: 'http://mock.url' });

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('채널을 찾을 수 없거나 메시지 전송이 불가능합니다')
    );
    consoleSpy.mockRestore();
  });
});
