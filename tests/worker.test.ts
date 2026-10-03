import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { TOKEN } from './fixtures';
const event = () => {
  const listeners: Function[] = [];
  return { listeners, addListener: (fn: Function) => listeners.push(fn) };
};
let chromeMock: any, stored: any;
async function settle() {
  await new Promise((r) => setTimeout(r, 20));
}
beforeEach(async () => {
  vi.resetModules();
  stored = {
    preferences: {
      apiUrl: 'https://api.example.com',
      token: 'x'.repeat(43),
      autoDetect: false,
      notifications: false,
    },
    notifiedAlertIds: [],
  };
  chromeMock = {
    runtime: { id: 'fixture', onInstalled: event(), onStartup: event(), onMessage: event() },
    sidePanel: { setPanelBehavior: vi.fn(async () => {}), open: vi.fn() },
    alarms: { create: vi.fn(async () => {}), onAlarm: event() },
    tabs: {
      onUpdated: event(),
      onActivated: event(),
      get: vi.fn(async () => ({ url: `https://basescan.org/token/${TOKEN}` })),
      query: vi.fn(async () => [{ url: `https://basescan.org/token/${TOKEN}`, active: true }]),
    },
    storage: {
      local: {
        get: vi.fn(async () => stored),
        set: vi.fn(async (v: any) => Object.assign(stored, v)),
      },
      session: { set: vi.fn(async () => {}) },
    },
    action: { setBadgeText: vi.fn(), setBadgeBackgroundColor: vi.fn() },
    permissions: { contains: vi.fn(async () => true) },
    notifications: { create: vi.fn(), onClicked: event() },
    windows: { getLastFocused: vi.fn(async () => ({ id: 1 })) },
  };
  vi.stubGlobal('chrome', chromeMock);
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          JSON.stringify([
            {
              id: 'alert1',
              read: false,
              title: 'Fixture changed',
              changes: [{ title: 'Implementation changed' }],
            },
          ]),
        ),
    ),
  );
  await import('../apps/extension/src/service-worker');
});
afterEach(() => vi.unstubAllGlobals());
describe('MV3 worker behavior using Chrome API fixtures', () => {
  it('sets native side-panel behavior and a resumable alert alarm', async () => {
    chromeMock.runtime.onInstalled.listeners[0]();
    await settle();
    expect(chromeMock.sidePanel.setPanelBehavior).toHaveBeenCalledWith({
      openPanelOnActionClick: true,
    });
    expect(chromeMock.alarms.create).toHaveBeenCalledWith('coinchecker-alerts', {
      periodInMinutes: 5,
    });
  });
  it('detects only after an explicit message and does not send browsing URLs to the backend', async () => {
    const reply = vi.fn();
    expect(chromeMock.runtime.onMessage.listeners[0]({ type: 'detect-token' }, null, reply)).toBe(
      true,
    );
    await settle();
    expect(reply).toHaveBeenCalledWith({
      detection: expect.objectContaining({ chainId: '8453', address: TOKEN }),
    });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('requires opt-in and ignores background-tab automatic suggestions', async () => {
    const update = chromeMock.tabs.onUpdated.listeners[0];
    update(1, { status: 'complete' }, { url: `https://basescan.org/token/${TOKEN}`, active: true });
    await settle();
    expect(chromeMock.storage.session.set).not.toHaveBeenCalled();
    stored.preferences.autoDetect = true;
    update(
      2,
      { status: 'complete' },
      { url: `https://basescan.org/token/${TOKEN}`, active: false },
    );
    await settle();
    expect(chromeMock.storage.session.set).not.toHaveBeenCalled();
    update(1, { status: 'complete' }, { url: `https://basescan.org/token/${TOKEN}`, active: true });
    await settle();
    expect(chromeMock.storage.session.set).toHaveBeenCalledWith({
      detectedToken: expect.objectContaining({ address: TOKEN, tabId: 1 }),
    });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('retrieves private alerts with a badge, and sends notifications only with opt-in', async () => {
    const alarm = chromeMock.alarms.onAlarm.listeners[0];
    alarm({ name: 'coinchecker-alerts' });
    await settle();
    expect(chromeMock.action.setBadgeText).toHaveBeenCalledWith({ text: '1' });
    expect(chromeMock.notifications.create).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledWith(
      'https://api.example.com/api/v1/alerts',
      expect.objectContaining({ headers: { Authorization: 'Bearer ' + 'x'.repeat(43) } }),
    );
    stored.preferences.notifications = true;
    stored.notifiedAlertIds = [];
    alarm({ name: 'coinchecker-alerts' });
    await settle();
    expect(chromeMock.notifications.create).toHaveBeenCalledTimes(1);
    alarm({ name: 'coinchecker-alerts' });
    await settle();
    expect(chromeMock.notifications.create).toHaveBeenCalledTimes(1);
  });
  it('keeps provider/network failures from crashing an alarm restart', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('offline'));
    chromeMock.alarms.onAlarm.listeners[0]({ name: 'coinchecker-alerts' });
    await settle();
    expect(chromeMock.action.setBadgeText).not.toHaveBeenCalled();
  });
});
