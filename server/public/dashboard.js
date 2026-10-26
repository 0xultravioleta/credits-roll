export function creditsAsText(viewers, formatTime = (value) => new Date(value).toISOString()) {
  if (!viewers.length)
    return 'No credited viewers in this view. Try the simulation or start listening to a live stream.';
  return viewers
    .map((row) =>
      [
        `@${row.viewer.login} | ${row.points} reputation | weight ${row.wheelWeight} | ${row.momentCount} moments | last credited ${formatTime(row.lastCreditedAt)}`,
        ...row.moments.map((moment) =>
          [
            `  Chat: ${moment.quote}`,
            `  ${moment.kind} | confidence ${Math.round(moment.confidence * 100)}% | ${moment.pointsEarned} points | ${formatTime(moment.occurredAt)}`,
            `  Streamer said: ${moment.adoptionExcerpt || 'Excerpt not captured for this older moment.'}`,
          ].join('\n'),
        ),
      ].join('\n'),
    )
    .join('\n\n');
}

export function renderCredits(table, viewers, document, formatTime) {
  const open = new Set(
    [...table.querySelectorAll('details[open]')].map((node) => node.dataset.viewer),
  );
  table.replaceChildren();
  for (const row of viewers) {
    const tr = document.createElement('tr');
    for (const value of [
      `@${row.viewer.login}`,
      row.points,
      row.wheelWeight,
      row.momentCount,
      formatTime(row.lastCreditedAt),
    ]) {
      const cell = document.createElement(tr.children.length ? 'td' : 'th');
      if (!tr.children.length) cell.scope = 'row';
      cell.textContent = String(value);
      tr.append(cell);
    }
    const cell = document.createElement('td');
    const details = document.createElement('details');
    details.dataset.viewer = row.viewer.id;
    details.open = open.has(row.viewer.id);
    const summary = document.createElement('summary');
    summary.textContent = `See ${row.momentCount} moments from @${row.viewer.login}`;
    details.append(summary);
    const list = document.createElement('ol');
    for (const moment of row.moments) {
      const item = document.createElement('li');
      for (const text of [
        `Viewer wrote: ${moment.quote}`,
        `Streamer said: ${moment.adoptionExcerpt || 'Excerpt not captured for this older moment.'}`,
        `${moment.kind} · ${Math.round(moment.confidence * 100)}% confidence · ${moment.pointsEarned} points earned · ${formatTime(moment.occurredAt)}`,
      ]) {
        const p = document.createElement('p');
        p.textContent = text;
        item.append(p);
      }
      list.append(item);
    }
    details.append(list);
    cell.append(details);
    tr.append(cell);
    table.append(tr);
  }
}

export function explainRewards(rules, prizeText) {
  return [
    `An idea starts at ${rules.basePoints.idea} points, an assist at ${rules.basePoints.assist}, and a riff at ${rules.basePoints.riff}. Multiply by the model's confidence and round to the nearest whole point.`,
    'Earned points add to the viewer’s reputation. Credited viewers appear in the end credits with their chat quotes.',
    `Reputation sets wheel weight: take the whole-number part of its square root, add ${rules.weightBase}, and cap the result at ${rules.weightCap}. A viewer who enters without reputation gets weight ${rules.weightBase}. A heavier weight means a better chance among entered viewers; it does not guarantee a win.`,
    'Viewers enter by redeeming “Enter the Credits Wheel” with Channel Points. This needs an Affiliate or Partner channel and an enabled reward.',
    `The prize is set by the streamer. Current saved prize: “${prizeText}”.`,
    'Today the rewards are recognition, reputation, an end-credits mention and a wheel chance. Nothing is paid. The streamer is responsible for delivering the prize they describe.',
  ];
}

export class DashboardConnection {
  constructor(fetcher = globalThis.fetch, now = Date.now) {
    this.fetcher = fetcher;
    this.now = now;
    this.state = null;
    this.reconnecting = false;
    this.pending = null;
  }
  refresh() {
    if (this.pending) return this.pending;
    this.pending = this.read().finally(() => {
      this.pending = null;
    });
    return this.pending;
  }
  async read() {
    let expired = false;
    try {
      const response = await this.fetcher('/dashboard/api/state', {
        cache: 'no-store',
        signal: AbortSignal.timeout(4000),
      });
      if (!response.ok) throw new Error('Server unavailable');
      const state = await response.json();
      if (
        !state ||
        typeof state.csrf !== 'string' ||
        !state.accounts ||
        !Array.isArray(state.setup?.steps) ||
        !state.settings ||
        !Array.isArray(state.activity) ||
        !Array.isArray(state.transcripts)
      )
        throw new Error('Incomplete dashboard state');
      this.state = state;
      this.lastConnectedAt = this.now();
      this.reconnecting = false;
    } catch {
      this.reconnecting = true;
      if (this.state) {
        const cutoff = this.now() - (this.state.historyRetentionMs ?? 72 * 60 * 60 * 1000);
        const lists = this.state.creditedViewerLists;
        if (lists) {
          const prune = (rows) =>
            rows.flatMap((row) => {
              const moments = row.moments.filter((moment) => moment.occurredAt > cutoff);
              if (!moments.length) {
                expired = true;
                return [];
              }
              if (moments.length !== row.moments.length) expired = true;
              return [
                {
                  ...row,
                  moments,
                  momentCount: moments.length,
                  lastCreditedAt: Math.max(...moments.map((moment) => moment.occurredAt)),
                },
              ];
            });
          this.state = {
            ...this.state,
            creditedViewerLists: { current: prune(lists.current), recent: prune(lists.recent) },
          };
        }
        if (this.now() - this.lastConnectedAt >= (this.state.activityRetentionMs ?? 90000)) {
          expired ||= this.state.activity.length > 0 || this.state.transcripts.length > 0;
          this.state = { ...this.state, activity: [], transcripts: [] };
        }
      }
    }
    return { state: this.state, reconnecting: this.reconnecting, expired };
  }
}

async function startDashboard() {
  const byId = (id) => document.getElementById(id);
  let csrf = '';
  const connection = new DashboardConnection();
  let initialized = false;
  let activityVersion = '';
  const pendingActions = new Set();
  let creditedViewerLists = { current: [], recent: [] };
  let creditsVersion = '';
  let savedPrizeText = '';
  let rewardsVersion = '';
  let savingPrize = false;
  const formatTime = (value) => new Date(value).toLocaleString();
  function showCredits() {
    const viewers = creditedViewerLists[byId('credit-scope').value];
    const version = JSON.stringify([byId('credit-scope').value, viewers]);
    if (version === creditsVersion) return;
    creditsVersion = version;
    byId('credits-copy').value = '';
    byId('credits-copy').hidden = true;
    byId('credits-empty').hidden = viewers.length > 0;
    byId('credited-table').hidden = !viewers.length;
    renderCredits(byId('credited-rows'), viewers, document, formatTime);
  }
  async function refresh() {
    try {
      const result = await connection.refresh();
      byId('reconnecting').hidden = !result.reconnecting;
      if (!result.state || (result.reconnecting && !result.expired)) return;
      const state = result.state;
      csrf = state.csrf;
      savedPrizeText = state.settings.prizeText;
      const rewardVersion = JSON.stringify([state.creditRules, savedPrizeText]);
      byId('prize-settings').querySelector('button').disabled = savingPrize || !state.creditRules;
      if (!state.creditRules)
        byId('reward-explanation').textContent =
          'Reward details need the updated server. Restart after your stream to enable them.';
      if (state.creditRules && rewardVersion !== rewardsVersion) {
        rewardsVersion = rewardVersion;
        byId('reward-explanation').replaceChildren(
          ...explainRewards(state.creditRules, savedPrizeText).map((text) => {
            const item = document.createElement('li');
            item.textContent = text;
            return item;
          }),
        );
        if (document.activeElement !== byId('reward-prize'))
          byId('reward-prize').value = savedPrizeText;
      }
      creditedViewerLists = state.creditedViewerLists ?? { current: [], recent: [] };
      showCredits();
      byId('credits-empty').textContent = state.creditedViewerLists
        ? "No credited viewers yet. Try the simulation, or start listening and adopt a viewer's suggestion out loud."
        : 'Credit history needs the updated server. Restart after your stream to enable this panel.';
      byId('streamer').textContent = state.accounts.streamer
        ? `@${state.accounts.streamer.login}`
        : 'Disconnected';
      byId('bot').textContent = state.accounts.bot
        ? `@${state.accounts.bot.login}`
        : 'Disconnected';
      byId('same-account').hidden = !state.setup.sameAccount;
      for (const button of document.querySelectorAll('button[data-role]'))
        button.disabled = pendingActions.has(button) || !state.accounts[button.dataset.role];
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
        button.disabled = pendingActions.has(button) || !state.practice.available;
      byId('live-spin').disabled =
        pendingActions.has(byId('live-spin')) ||
        !state.settings.wheelEnabled ||
        !state.accounts.streamer ||
        !state.accounts.bot;
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
      byId('start-listening').disabled =
        pendingActions.has(byId('start-listening')) || !state.setup.canStart;
      const version = state.activity.map((row) => row.id).join(',');
      if (version !== activityVersion) {
        activityVersion = version;
        const activity = byId('activity');
        activity.replaceChildren();
        for (const row of state.activity) {
          const item = document.createElement('li');
          item.textContent = row.text;
          activity.append(item);
        }
        if (!state.activity.length) {
          const item = document.createElement('li');
          item.textContent = 'No activity yet. Try the two simulation buttons above.';
          activity.append(item);
        }
      }
      if (!initialized) {
        byId('language').value = state.settings.language;
        byId('confidence').value = state.settings.confidenceThreshold;
        byId('reward-prize').value = state.settings.prizeText;
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
      byId('reconnecting').hidden = false;
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
      pendingActions.add(button);
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
        pendingActions.delete(button);
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
        prizeText: savedPrizeText,
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
  byId('prize-settings').addEventListener('submit', async (event) => {
    event.preventDefault();
    savingPrize = true;
    const button = event.submitter;
    button.disabled = true;
    try {
      const settings = await post('prize', { prizeText: byId('reward-prize').value });
      savedPrizeText = settings.prizeText;
      byId('reward-prize').value = settings.prizeText;
      byId('message').textContent = 'Prize saved. This is what the wheel winner gets.';
    } catch (error) {
      byId('message').textContent = error.message;
    } finally {
      savingPrize = false;
      button.disabled = false;
      await refresh();
    }
  });
  if (new URLSearchParams(location.search).get('auth') === 'failed')
    byId('message').textContent =
      'Twitch authorization failed. Twitch may have reused the streamer account. Log out of Twitch or use a private window to connect a different bot account.';
  history.replaceState(null, '', '/dashboard');
  byId('credit-scope').addEventListener('change', showCredits);
  byId('copy-credits').addEventListener('click', async () => {
    const text = creditsAsText(creditedViewerLists[byId('credit-scope').value], formatTime);
    try {
      await navigator.clipboard.writeText(text);
      byId('message').textContent = 'Credited viewers copied as text.';
    } catch {
      byId('credits-copy').hidden = false;
      byId('credits-copy').value = text;
      byId('credits-copy').select();
      byId('message').textContent = 'Copy the selected text below the credited viewers table.';
    }
  });
  await refresh();
  setInterval(() => {
    void refresh();
  }, 1000);
}

if (typeof document !== 'undefined') await startDashboard();
