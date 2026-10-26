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
    byId('same-account').hidden = !state.setup.sameAccount;
    for (const button of document.querySelectorAll('button[data-role]'))
      button.disabled = !state.accounts[button.dataset.role];
    byId('status').textContent = state.oauthConfigured
      ? state.status
      : 'Offline mode. Configure your Twitch application to connect accounts.';
    byId('moments').textContent = String(state.moments);
    byId('viewers').textContent = String(state.creditedViewers);
    byId('phase').textContent = state.phase;
    byId('practice-reason').textContent = state.practice.reason;
    byId('wheel-status').textContent = state.wheelStatus;
    byId('counter-context').textContent = state.practice.active
      ? 'Practice counters and reputation. Nothing here is sent to Twitch.'
      : 'Counters for the current stream on the overlay.';
    for (const button of document.querySelectorAll('button[data-practice]'))
      button.disabled = !state.practice.available;
    byId('winner').textContent = state.winner ? `Wheel winner: @${state.winner.login}` : '';
    byId('overlay-url').value = state.setup.overlayUrl;
    for (const step of state.setup.steps) {
      const badge = byId(`step-${step.id}`);
      badge.textContent = step.done ? 'Done' : 'Not done';
      badge.classList.toggle('done', step.done);
      const details = byId(`details-${step.id}`);
      details.replaceChildren();
      for (const text of step.details) {
        const item = document.createElement('li');
        item.textContent = text;
        details.append(item);
      }
    }
    byId('start-listening').disabled = !state.setup.canStart;
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
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? `Action failed (HTTP ${response.status}).`);
  return result;
}
for (const button of document.querySelectorAll('button[data-action]')) {
  button.addEventListener('click', async () => {
    button.disabled = true;
    byId('message').textContent = '';
    try {
      const result = await post(
        button.dataset.action,
        button.dataset.role ? { role: button.dataset.role } : {},
      );
      byId('message').textContent = result.message ?? 'Action complete.';
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
byId('copy-overlay').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(byId('overlay-url').value);
    byId('message').textContent = 'Overlay URL copied. Paste it into the OBS Browser Source.';
  } catch {
    byId('overlay-url').select();
    byId('message').textContent = 'Select and copy the URL, then paste it into OBS.';
  }
});
if (new URLSearchParams(location.search).get('auth') === 'failed')
  byId('message').textContent =
    'Twitch authorization failed. Twitch may have reused the streamer account. Log out of Twitch or use a private window to connect a different bot account.';
history.replaceState(null, '', '/dashboard');
await refresh();
setInterval(() => {
  void refresh();
}, 1000);
