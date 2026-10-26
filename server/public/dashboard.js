const byId = (id) => document.getElementById(id);
let csrf = '';
let initialized = false;
async function refresh() {
  try {
    const response = await fetch('/dashboard/api/state', {
      cache: 'no-store',
      signal: AbortSignal.timeout(4000),
    });
    if (!response.ok) throw new Error();
    const state = await response.json();
    csrf = state.csrf;
    byId('streamer').textContent = state.accounts.streamer
      ? `@${state.accounts.streamer.login}`
      : 'Disconnected';
    byId('bot').textContent = state.accounts.bot ? `@${state.accounts.bot.login}` : 'Disconnected';
    byId('status').textContent = state.oauthConfigured
      ? state.status
      : 'Offline mode. Configure your Twitch application to connect accounts.';
    byId('moments').textContent = String(state.moments);
    byId('viewers').textContent = String(state.creditedViewers);
    byId('phase').textContent = state.phase;
    byId('overlay-url').textContent = `${location.origin}/overlay`;
    if (!initialized) {
      byId('language').value = state.settings.language;
      byId('confidence').value = state.settings.confidenceThreshold;
      byId('prize').value = state.settings.prizeText;
      byId('quiet').checked = state.settings.quietMode;
      byId('wheel').checked = state.settings.wheelEnabled;
      initialized = true;
    }
    const list = byId('transcripts');
    list.replaceChildren();
    for (const window of state.transcripts) {
      const item = document.createElement('li');
      item.textContent = window.text;
      list.append(item);
    }
    if (!state.transcripts.length) {
      const item = document.createElement('li');
      item.textContent = 'No transcript yet.';
      list.append(item);
    }
  } catch {
    byId('status').textContent = 'Local server unavailable. Reconnecting…';
  }
}
async function post(action, body = {}) {
  const response = await fetch(`/dashboard/api/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Credits-CSRF': csrf },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok)
    throw new Error(
      `Action failed (HTTP ${response.status}). Check account connections and channel eligibility.`,
    );
  return response.json();
}
for (const button of document.querySelectorAll('button[data-action]')) {
  button.addEventListener('click', async () => {
    button.disabled = true;
    byId('message').textContent = '';
    try {
      const result = await post(button.dataset.action);
      byId('message').textContent = 'Action complete.';
      if (result.winner)
        byId('winner').textContent = `Wheel winner: @${result.winner.viewer.login}`;
    } catch (error) {
      byId('message').textContent = error.message;
    } finally {
      button.disabled = false;
      await refresh();
    }
  });
}
byId('settings').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true;
  try {
    await post('settings', {
      language: byId('language').value,
      confidenceThreshold: Number(byId('confidence').value),
      prizeText: byId('prize').value,
      quietMode: byId('quiet').checked,
      wheelEnabled: byId('wheel').checked,
    });
    byId('message').textContent = 'Settings saved.';
  } catch (error) {
    byId('message').textContent = error.message;
  } finally {
    button.disabled = false;
  }
});
if (new URLSearchParams(location.search).get('auth') === 'failed')
  byId('message').textContent =
    'Twitch authorization failed. Choose the correct account and try again.';
history.replaceState(null, '', '/dashboard');
await refresh();
setInterval(() => {
  void refresh();
}, 1000);
