import { detectActiveTab, detectFromUrl } from './detection';
import type { Alert } from '@coinchecker/shared';
import type { Preferences } from './client';

async function setup() {
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  await chrome.alarms.create('coinchecker-alerts', { periodInMinutes: 5 });
}
chrome.runtime.onInstalled.addListener(() => void setup());
chrome.runtime.onStartup.addListener(() => void setup());
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'detect-token') {
    void detectActiveTab()
      .then((d) => sendResponse({ detection: d }))
      .catch(() => sendResponse({ detection: null }));
    return true;
  }
  return false;
});
chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
  if ((change.status !== 'complete' && !change.url) || !tab.url || !tab.active) return;
  void suggest(tabId, tab.url).catch(() => {});
});
chrome.tabs.onActivated.addListener(({ tabId }) => {
  void chrome.tabs
    .get(tabId)
    .then((tab) => suggest(tabId, tab.url))
    .catch(() => {});
});
async function suggest(tabId: number, url: string | undefined) {
  await chrome.storage.local.get('preferences').then(async (values) => {
    const p = values.preferences as Preferences | undefined;
    if (!p?.autoDetect) return;
    const detection = url ? detectFromUrl(url) : null;
    await chrome.storage.session.set({ detectedToken: detection ? { ...detection, tabId } : null });
  });
}
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'coinchecker-alerts') void pollAlerts();
});
async function pollAlerts() {
  const stored = await chrome.storage.local.get(['preferences', 'notifiedAlertIds']);
  const p = stored.preferences as Preferences | undefined;
  const seen = Array.isArray(stored.notifiedAlertIds)
    ? stored.notifiedAlertIds.filter((v): v is string => typeof v === 'string')
    : [];
  if (!p?.token) return;
  try {
    const response = await fetch(`${p.apiUrl}/api/v1/alerts`, {
      headers: { Authorization: `Bearer ${p.token}` },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) return;
    const alerts = (await response.json()) as Alert[],
      unread = alerts.filter((a) => !a.read);
    await chrome.action.setBadgeText({ text: unread.length ? String(unread.length) : '' });
    await chrome.action.setBadgeBackgroundColor({ color: '#ffca61' });
    const permission = await chrome.permissions.contains({ permissions: ['notifications'] });
    if (p.notifications && permission) {
      for (const alert of unread.filter((a) => !seen.includes(a.id)).slice(0, 5)) {
        await chrome.notifications.create(alert.id, {
          type: 'basic',
          iconUrl: 'assets/coinchecker-mark.png',
          title: 'Coinchecker · Token changed',
          message: alert.title.slice(0, 180),
          priority: 1,
        });
      }
    }
    await chrome.storage.local.set({
      notifiedAlertIds: [...new Set([...seen, ...alerts.map((a) => a.id)])].slice(-200),
    });
  } catch {
    /* Next alarm retries. The backend monitor does not depend on this worker remaining alive. */
  }
}
if (chrome.notifications?.onClicked)
  chrome.notifications.onClicked.addListener(() => {
    void chrome.windows.getLastFocused().then((window) => {
      if (window.id) void chrome.sidePanel.open({ windowId: window.id }).catch(() => {});
    });
  });
