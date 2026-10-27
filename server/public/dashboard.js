export function listeningLabel(status, now = Date.now(), reconnecting = false) {
  if (!status) return 'x Not listening — Checking local state.';
  const age = (value) =>
    value === null ? 'not received yet' : Math.max(0, Math.floor((now - value) / 1000)) + ' s ago';
  const label = status.listening
    ? '*** Listening — last audio ' +
      age(status.lastAudioAt) +
      '; last chat ' +
      age(status.lastChatAt) +
      '. ' +
      status.reason
    : status.phase === 'standby'
      ? '~ Standby — ' + status.reason
      : 'x Not listening — ' + status.reason;
  return reconnecting ? 'Reconnecting... Last known: ' + label : label;
}
export function forecastLabel(forecast, now = Date.now()) {
  if (!forecast) return 'Chat forecast is unavailable. Connect an eligible live channel.';
  const deadline = forecast.phase === 'correction' ? forecast.correctionEndsAt : forecast.endsAt;
  const seconds = Math.max(0, Math.ceil(((deadline ?? now) - now) / 1000));
  const time = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  return `${forecast.source === 'demo' ? 'Demo forecast (no Twitch points)' : 'Chat forecast'} ${forecast.count}/${forecast.target} · ${forecast.phase === 'counting' ? time + ' left' : forecast.phase === 'correction' ? time + ' to correct' : forecast.phase}`;
}

export function goLiveChecklist(state) {
  const capabilities = state.capabilities;
  return [
    {
      done: !!state.accounts.streamer && !!state.accounts.bot && !state.setup.sameAccount,
      text:
        state.accounts.streamer && state.accounts.bot
          ? 'Accounts: @' +
            state.accounts.streamer.login +
            ' hears the stream; @' +
            state.accounts.bot.login +
            ' is the separate chat bot.'
          : 'Connect the streamer and a different bot account.',
    },
    {
      done: capabilities?.broadcasterType !== null && capabilities?.broadcasterType !== undefined,
      text:
        'Channel type: ' +
        (capabilities?.channelType ?? 'Not checked yet') +
        '. ' +
        (capabilities?.eligibilityReason ?? ''),
    },
    {
      done: capabilities?.coreScopes.every((row) => row.granted) ?? false,
      text:
        'Listening permissions: ' +
        (capabilities?.coreScopes.every((row) => row.granted)
          ? 'granted.'
          : 'Reconnect the account with missing permissions.'),
    },
    {
      done: state.setup.steps.find((step) => step.id === 'overlay')?.done ?? false,
      text:
        'Overlay: ' +
        (state.setup.steps.find((step) => step.id === 'overlay')?.done
          ? 'connected. Confirm that this is your OBS Browser Source.'
          : 'not connected. Add the Browser Source to OBS and keep its scene active.'),
    },
    {
      done: state.listeningStatus?.listening ?? false,
      text: listeningLabel(state.listeningStatus),
    },
  ];
}

export function mediaCells(row) {
  const clip = row.media?.clip;
  const marker = row.media?.marker;
  let url;
  if (clip?.status === 'ready' && typeof clip.url === 'string') {
    if (/^\/demo\/clip\/[\w-]+$/.test(clip.url)) url = clip.url;
    else
      try {
        const parsed = new URL(clip.url);
        if (
          parsed.protocol === 'https:' &&
          !parsed.username &&
          !parsed.password &&
          !parsed.port &&
          (parsed.hostname === 'clips.twitch.tv' ||
            (['twitch.tv', 'www.twitch.tv'].includes(parsed.hostname) &&
              parsed.pathname.includes('/clip/')))
        )
          url = clip.url;
      } catch {
        /* Invalid external links stay plain text. */
      }
  }
  return {
    clip: {
      label: url
        ? clip.demo
          ? 'Demo clip - not on Twitch'
          : 'Open Twitch clip'
        : (clip?.status ?? 'Not requested'),
      url,
    },
    marker:
      marker?.status === 'ready'
        ? (clip?.demo ? 'Demo marker ' : 'Marker ') +
          marker.id +
          ' @ ' +
          marker.positionSeconds +
          ' s'
        : (marker?.status ?? 'Not requested'),
  };
}

export function filterCredits(records, filters = {}) {
  const viewer = (filters.viewer ?? '').trim().replace(/^@/, '').toLowerCase();
  return records
    .filter(
      (row) =>
        (!viewer || row.login.toLowerCase().includes(viewer)) &&
        (!filters.stream || row.streamId === filters.stream) &&
        (!filters.kind || row.kind === filters.kind),
    )
    .sort((a, b) => b.time.localeCompare(a.time) || b.id.localeCompare(a.id));
}
export function creditTotals(records) {
  return {
    credits: records.length,
    viewers: new Set(records.map((row) => row.viewerId)).size,
    points: records.reduce((sum, row) => sum + row.points, 0),
  };
}
export function ledgerAsText(records) {
  return records
    .map(
      (row) =>
        row.time +
        ' | @' +
        row.login +
        ' | ' +
        row.streamId +
        ' | ' +
        row.kind +
        ' | ' +
        row.points +
        ' points | ' +
        Math.round(row.confidence * 100) +
        '% confidence\nViewer wrote: ' +
        row.quote +
        '\nStreamer said: ' +
        (row.adoptionExcerpt || 'Excerpt not captured.') +
        '\nClip: ' +
        (mediaCells(row).clip.url ?? mediaCells(row).clip.label) +
        '\nVOD marker: ' +
        mediaCells(row).marker,
    )
    .join('\n\n');
}
export function ledgerAsCsv(records) {
  const columns = [
    'schema',
    'id',
    'time',
    'streamId',
    'channelId',
    'viewerId',
    'login',
    'kind',
    'confidence',
    'points',
    'quote',
    'adoptionExcerpt',
    'judgeModel',
    'Clip',
    'VOD marker',
  ];
  const cell = (value) => {
    let text = String(value);
    if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  };
  return (
    columns.join(',') +
    '\r\n' +
    records
      .map((row) => {
        const media = mediaCells(row);
        const values = {
          ...row,
          Clip: media.clip.url ?? media.clip.label,
          'VOD marker': media.marker,
        };
        return columns.map((column) => cell(values[column])).join(',');
      })
      .join('\r\n') +
    '\r\n'
  );
}

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
    `The streamer chooses one of four available prizes. Current saved prize: “${prizeText}”.`,
    'The rewards are recognition, reputation, an end-credits mention and a wheel chance. Native Twitch Predictions can also redistribute participants’ Channel Points; Twitch handles those points and refunds. Credits Roll never creates points. Nothing is paid. The streamer delivers the selected wheel prize.',
  ];
}

export function explainMatching(rules, settings) {
  return [
    'We exclude ignored service accounts, your streamer, your connected bot, commands and instruction attacks before judging.',
    'We look back ' +
      settings.lookbackSeconds +
      ' seconds before the reply or audio chunk. The range is ' +
      rules.minLookbackSeconds +
      '–' +
      rules.maxLookbackSeconds +
      ' seconds. Messages inside an audio chunk have uncertain order.',
    'Text must have ' +
      rules.duplicateMinTextLength +
      ' characters for repeated suggestions and at most ' +
      rules.maxTextLength +
      ' characters overall. Unique short suggestions can still be judged. Short reactions such as lol, +1 and f never count. For identical text we ' +
      (settings.duplicatePolicy === 'keep-first'
        ? 'keep the earliest copy; that is a trial attribution rule, not proof of influence.'
        : 'reject copies from different viewers.'),
    'At most ' +
      rules.maxCandidates +
      ' candidates reach the judge. Saved confidence threshold: ' +
      settings.confidenceThreshold.toFixed(2) +
      '. The trial default is ' +
      rules.defaultConfidence.toFixed(2) +
      '; the slider allows ' +
      rules.minConfidence.toFixed(2) +
      '–' +
      rules.maxThreshold.toFixed(2) +
      '. Lower it to consider weaker evidence; expect more mistakes. Save settings to apply changes.',
    'After-reply candidates are ' +
      (settings.allowAfterReply ? 'ON' : 'OFF') +
      '. When enabled, we wait up to ' +
      rules.tailSeconds +
      ' seconds after the reply boundary. The judge sees who spoke first. Later chat cannot cause an earlier action; only a weak riff is eligible, capped at ' +
      rules.tailConfidenceCap.toFixed(2) +
      ' confidence. A higher threshold still drops it.',
    'The debug log records intake decisions, ordering, confidence, the threshold and rejection reasons. Kept means the judge filter passed; duplicate or opted-out credits can still be blocked by storage.',
  ];
}

export class DashboardConnection {
  constructor(fetcher = globalThis.fetch, now = Date.now) {
    this.fetcher = (...args) => Reflect.apply(fetcher, globalThis, args);
    this.now = () => now();
    this.state = null;
    this.reconnecting = false;
    this.requiresLogin = false;
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
      if (response.status === 401) this.requiresLogin = true;
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
      this.requiresLogin = false;
    } catch {
      this.reconnecting = true;
      if (this.state) {
        const cutoff = this.now() - (this.state.historyRetentionMs ?? 72 * 60 * 60 * 1000);
        const lists = this.state.creditedViewerLists;
        if (lists && !this.state.durableHistory) {
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
    return {
      state: this.state,
      reconnecting: this.reconnecting,
      requiresLogin: this.requiresLogin,
      expired,
    };
  }
}

async function startDashboard() {
  const byId = (id) => document.getElementById(id);
  let csrf = '';
  const connection = new DashboardConnection();
  let initialized = false;
  let activityVersion = '';
  const pendingActions = new Set();
  let savedPrizeText = '';
  let rewardsVersion = '';
  let savingPrize = false;
  let ledgerRecords = [];
  let ledgerKey = '';
  let ledgerPending = Promise.resolve();
  let forecastReviewVersion = '';
  let visibleCredits = 100;
  const formatTime = (value) => new Date(value).toLocaleString();
  const selectedCredits = () =>
    filterCredits(ledgerRecords, {
      viewer: byId('ledger-viewer').value,
      stream: byId('ledger-stream').value,
      kind: byId('ledger-kind').value,
    });
  function showCredits() {
    const records = selectedCredits();
    const totals = creditTotals(records);
    byId('ledger-totals').textContent =
      totals.credits +
      ' credits given · ' +
      totals.viewers +
      ' viewers credited · ' +
      totals.points +
      ' points';
    byId('credits-empty').hidden = records.length > 0;
    byId('credited-table').hidden = records.length === 0;
    byId('more-credits').hidden = records.length <= visibleCredits;
    byId('credits-copy').value = '';
    byId('credits-copy').hidden = true;
    const table = byId('credited-rows');
    table.replaceChildren();
    for (const row of records.slice(0, visibleCredits)) {
      const tr = document.createElement('tr');
      for (const text of [
        formatTime(row.time),
        '@' + row.login,
        row.streamId,
        row.kind,
        Math.round(row.confidence * 100) + '%',
        row.points,
        row.quote,
        row.adoptionExcerpt || 'Excerpt not captured.',
      ]) {
        const td = document.createElement('td');
        td.textContent = String(text);
        tr.append(td);
      }
      const media = mediaCells(row);
      const clipCell = document.createElement('td');
      if (media.clip.url) {
        const link = document.createElement('a');
        link.href = media.clip.url;
        link.textContent = media.clip.label;
        link.target = '_blank';
        link.rel = 'noreferrer noopener';
        clipCell.append(link);
      } else clipCell.textContent = media.clip.label;
      const markerCell = document.createElement('td');
      markerCell.textContent = media.marker;
      tr.append(clipCell, markerCell);
      table.append(tr);
    }
  }
  function loadLedger(force = false) {
    const operation = ledgerPending.then(() => readLedger(force));
    ledgerPending = operation.catch(() => undefined);
    return operation;
  }
  async function readLedger(force) {
    const state = connection.state;
    if (!state?.durableHistory) {
      byId('ledger-message').textContent =
        'Restart the updated server after your stream to enable the saved ledger.';
      return false;
    }
    const key = state.csrf + ':' + state.ledgerVersion;
    if (!force && key === ledgerKey) return true;
    const response = await fetch('/dashboard/api/ledger', {
      cache: 'no-store',
      signal: AbortSignal.timeout(4000),
    });
    if (!response.ok) throw new Error('Saved credits are unavailable. Reconnect before exporting.');
    const data = await response.json();
    ledgerRecords = data.records;
    ledgerKey = state.csrf + ':' + data.version;
    const streamSelect = byId('ledger-stream');
    const selected = streamSelect.value;
    streamSelect.replaceChildren();
    for (const value of ['', ...new Set(ledgerRecords.map((row) => row.streamId))]) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = value || 'All streams';
      streamSelect.append(option);
    }
    streamSelect.value = [...streamSelect.options].some((option) => option.value === selected)
      ? selected
      : '';
    byId('ledger-message').textContent = '';
    showCredits();
    return true;
  }
  async function refresh() {
    try {
      const result = await connection.refresh();
      byId('sign-in-again').hidden = !result.requiresLogin;
      byId('reconnecting').hidden = !result.reconnecting;
      byId('listening-status').textContent = listeningLabel(
        result.state?.listeningStatus,
        Date.now(),
        result.reconnecting,
      );
      if (!result.state || (result.reconnecting && !result.expired)) return;
      const state = result.state;
      const forecast = state.forecast;
      byId('forecast-availability').textContent =
        forecast?.message ??
        'Native forecasts need an eligible live channel. Demo and practice never call Twitch.';
      byId('forecast-controls').hidden = !forecast?.visible;
      byId('forecast-reconnect').hidden = !(
        forecast?.visible &&
        state.capabilities?.features.some((row) => row.feature === 'predictions' && !row.granted)
      );
      byId('forecast-status').textContent = forecastLabel(forecast);
      byId('forecast-proposal').textContent = forecast?.proposed
        ? `Proposed outcome: ${forecast.proposed}. ${forecast.phase === 'resolved' ? 'Twitch handles native payouts.' : 'The app resolves automatically after review.'}`
        : '';
      byId('forecast-start').disabled =
        !forecast?.canStart ||
        forecast.source === 'demo' ||
        pendingActions.has(byId('forecast-start'));
      byId('forecast-cancel').disabled =
        !forecast ||
        forecast.source === 'demo' ||
        !['counting', 'correction', 'canceling'].includes(forecast.phase) ||
        pendingActions.has(byId('forecast-cancel'));
      if (state.forecastRules) {
        byId('forecast-minutes').min = state.forecastRules.minMinutes;
        byId('forecast-minutes').max = state.forecastRules.maxMinutes;
        if (!initialized) byId('forecast-minutes').value = state.forecastRules.defaultMinutes;
      }
      const review = forecast?.phase === 'correction' ? (state.forecastMoments ?? []) : [];
      const reviewVersion = JSON.stringify(review);
      if (forecastReviewVersion !== reviewVersion) {
        forecastReviewVersion = reviewVersion;
        byId('forecast-review').replaceChildren();
        for (const moment of review) {
          const item = document.createElement('li');
          item.append(
            `@${moment.viewer.login}: “${moment.quote}” — ${moment.excluded ? 'excluded from forecast' : 'counted'}. `,
          );
          const button = document.createElement('button');
          button.type = 'button';
          button.textContent = moment.excluded ? 'Count this credit again' : 'Not a real credit';
          button.addEventListener('click', async () => {
            button.disabled = true;
            try {
              await post('forecast/correct', { momentId: moment.id, excluded: !moment.excluded });
              byId('forecast-message').textContent =
                'Forecast tally corrected. Recognition and reputation are unchanged.';
            } catch (error) {
              byId('forecast-message').textContent = error.message;
            } finally {
              button.disabled = false;
              await refresh();
            }
          });
          item.append(button);
          byId('forecast-review').append(item);
        }
      }
      byId('account-switch-help').hidden = !!state.hosted;
      byId('hosted-account-help').hidden = !state.hosted;
      if (state.matchRules) {
        const rules = state.matchRules;
        byId('confidence').min = rules.minConfidence;
        byId('confidence').max = rules.maxThreshold;
        byId('lookback').min = rules.minLookbackSeconds;
        byId('lookback').max = rules.maxLookbackSeconds;
        byId('matching-explanation').replaceChildren(
          ...explainMatching(rules, state.settings).map((text) => {
            const item = document.createElement('li');
            item.textContent = text;
            return item;
          }),
        );
      }
      csrf = state.csrf;
      byId('listening-banner').hidden = !(
        state.listening ?? state.setup.steps.find((step) => step.id === 'listening')?.done
      );
      byId('ledger-warning').hidden = !state.ledgerWarning;
      byId('listening-banner-text').textContent = state.listeningStatus?.listening
        ? 'Listening to your stream now. Stop listening to use the practice buttons.'
        : 'Connecting or retrying live input. Stop listening cancels retries and makes practice available.';
      byId('ledger-warning').textContent = state.ledgerWarning ?? '';
      savedPrizeText = state.settings.prizeText;
      if (state.prizes && byId('reward-prize').options.length !== state.prizes.length) {
        byId('reward-prize').replaceChildren(
          ...state.prizes.map((prize) => {
            const option = document.createElement('option');
            option.value = prize;
            option.textContent = prize;
            return option;
          }),
        );
      }
      byId('entries-refunded').textContent = 'Entries refunded: ' + (state.entriesRefunded ?? 0);
      byId('free-entry-option').hidden = !state.capabilities?.wheelAvailable;
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
      try {
        await loadLedger();
      } catch (error) {
        byId('ledger-message').textContent = error.message;
      }
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
      byId('listening-status').textContent = listeningLabel(
        state.listeningStatus,
        Date.now(),
        connection.reconnecting,
      );
      byId('auto-listen-status').textContent =
        'Saved auto-listen: ' +
        (state.settings.autoListen
          ? 'ON. Keep this server running to wait for Twitch.'
          : 'OFF. Start listening manually when live.');
      const goLive = byId('go-live-checklist');
      goLive.replaceChildren(
        ...goLiveChecklist(state).map((row) => {
          const item = document.createElement('li');
          item.textContent = (row.done ? 'Ready: ' : 'Check: ') + row.text;
          return item;
        }),
      );
      const permissions = byId('go-live-permissions');
      permissions.replaceChildren();
      for (const row of state.capabilities?.coreScopes ?? []) {
        const item = document.createElement('li');
        item.textContent =
          row.role + ': ' + row.scope + (row.granted ? ' — granted' : ' — missing. ');
        if (!row.granted) {
          const link = document.createElement('a');
          link.href = '/auth/login?role=' + row.role;
          link.textContent = 'Reconnect ' + row.role;
          item.append(link);
        }
        permissions.append(item);
      }
      for (const feature of state.capabilities?.features ?? []) {
        const item = document.createElement('li');
        item.textContent =
          feature.message + (!feature.visible ? ' (Unavailable for this channel type.)' : '');
        if (!feature.granted) {
          const link = document.createElement('a');
          link.href = '/auth/login?role=streamer';
          link.textContent = 'Reconnect streamer';
          item.append(' ', link);
        }
        permissions.append(item);
      }
      byId('supervisor-alert').hidden = !state.supervisorAlert;
      if (state.supervisorAlert)
        byId('supervisor-alert-text').textContent =
          'Saved alert from ' +
          state.supervisorAlert.time +
          ': automatic restarts stopped after five restarts in ten minutes. Review the server log and fix the cause before starting one supervisor. This alert remains until acknowledged.';
      byId('wheel-option').hidden = !state.capabilities?.wheelAvailable;
      byId('live-spin').hidden = !state.capabilities?.wheelAvailable;
      byId('channel-eligibility').textContent =
        state.capabilities?.eligibilityReason ?? 'Channel type not checked.';
      byId('clip-status').textContent =
        (state.settings.clipsEnabled ? 'Live clips ON. ' : 'Live clips OFF. ') +
        (state.clips?.message ?? '') +
        ' ' +
        (state.clips?.markerMessage ?? 'Markers need VOD storage.');
      byId('forgotten-clips').textContent =
        'Clips naming forgotten viewers: ' +
        (state.forgottenClipCount ?? 0) +
        ' - delete them in Creator Dashboard -> Clips';
      byId('moments').textContent = String(state.moments);
      byId('viewers').textContent = String(state.creditedViewers);
      byId('phase').textContent = state.phase;
      byId('practice-reason').textContent = state.practice.reason;
      byId('wheel-status').textContent = state.wheelStatus;
      byId('ignored-effective').textContent =
        'Currently ignored: ' + (state.ignoredLogins ?? []).join(', ');
      if (state.debug)
        byId('debug-status').textContent =
          (state.debug.enabled ? 'Debug log on. ' : 'Debug log off. ') +
          'Ignored bots: ' +
          (state.debug.decisions['ignored-bot'] ?? 0) +
          '. Decisions: ' +
          JSON.stringify(state.debug.decisions) +
          '. Bytes: ' +
          state.debug.bytes +
          '. Capacity drops: ' +
          state.debug.dropped +
          (state.debug.error ? '. ' + state.debug.error : '');
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
      for (const link of document.querySelectorAll('a[href^="/overlay/"], a[data-overlay-link]')) {
        const preview = new URL(link.href).searchParams.has('preview');
        const url = new URL(state.setup.overlayUrl);
        if (preview) url.searchParams.set('preview', '1');
        link.href = url.href;
        link.dataset.overlayLink = 'true';
      }
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
      byId('start-listening').disabled = pendingActions.has(byId('start-listening'));
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
        byId('confidence-value').textContent = Number(state.settings.confidenceThreshold).toFixed(
          2,
        );
        byId('lookback').value = state.settings.lookbackSeconds;
        byId('duplicate-policy').value = state.settings.duplicatePolicy;
        byId('allow-after-reply').checked = state.settings.allowAfterReply;
        byId('reward-prize').value = state.settings.prizeText;
        byId('free-entry').checked = state.settings.creditedViewersEnterFree;
        byId('quiet').checked = state.settings.quietMode;
        byId('wheel').checked = state.settings.wheelEnabled;
        byId('ignored-logins').value = (state.settings.ignoredLogins ?? []).join(', ');
        byId('debug-log').checked = state.settings.debugLog ?? true;
        byId('auto-listen').checked = state.settings.autoListen ?? true;
        byId('clip-each').checked = state.settings.clipsEnabled ?? true;
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
    const inlineMessage = document.createElement('span');
    inlineMessage.className = 'action-message';
    inlineMessage.setAttribute('role', 'status');
    button.after(inlineMessage);
    button.addEventListener('click', async () => {
      inlineMessage.textContent =
        button.dataset.action === 'start'
          ? 'Checking the channel and starting listening…'
          : button.dataset.action === 'stop'
            ? 'Stopping listening…'
            : 'Working…';
      pendingActions.add(button);
      button.disabled = true;
      byId('message').textContent = '';
      try {
        const result = await post(
          button.dataset.action,
          button.dataset.role ? { role: button.dataset.role } : {},
        );
        byId('message').textContent = result.message ?? 'Action complete.';
        inlineMessage.textContent =
          result.message ??
          (button.dataset.action === 'start'
            ? 'Start requested. Waiting for audio; check the header for progress or a retry reason.'
            : button.dataset.action === 'stop'
              ? 'Listening stopped. You can use the practice buttons.'
              : 'Action complete.');
        if (result.winner)
          byId('winner').textContent = `Wheel winner: @${result.winner.viewer.login}`;
      } catch (error) {
        inlineMessage.textContent = error.message;
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
        lookbackSeconds: Number(byId('lookback').value),
        duplicatePolicy: byId('duplicate-policy').value,
        allowAfterReply: byId('allow-after-reply').checked,
        prizeText: savedPrizeText,
        quietMode: byId('quiet').checked,
        wheelEnabled: byId('wheel').checked,
        debugLog: byId('debug-log').checked,
        autoListen: byId('auto-listen').checked,
        clipsEnabled: byId('clip-each').checked,
        creditedViewersEnterFree: byId('free-entry').checked,
        ignoredLogins: byId('ignored-logins')
          .value.split(',')
          .map((value) => value.trim())
          .filter(Boolean),
      });
      byId('message').textContent = 'Settings saved.';
    } catch (error) {
      byId('message').textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });
  byId('forecast-start-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = byId('forecast-start');
    pendingActions.add(button);
    button.disabled = true;
    byId('forecast-message').textContent = 'Checking Twitch and creating the forecast...';
    try {
      const result = await post('forecast/start', {
        minutes: Number(byId('forecast-minutes').value),
      });
      byId('forecast-message').textContent = result.message;
    } catch (error) {
      byId('forecast-message').textContent = error.message;
    } finally {
      pendingActions.delete(button);
      await refresh();
    }
  });
  byId('confidence').addEventListener('input', () => {
    byId('confidence-value').textContent = Number(byId('confidence').value).toFixed(2);
  });
  byId('download-debug').addEventListener('click', async () => {
    try {
      const response = await fetch('/dashboard/api/debug/download', {
        signal: AbortSignal.timeout(4000),
        method: 'POST',
        headers: { 'X-Credits-CSRF': csrf },
        cache: 'no-store',
      });
      if (!response.ok) throw new Error('Debug log download failed. Reconnect and try again.');
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = 'credits-debug.jsonl';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      byId('debug-status').textContent = error.message;
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
  for (const id of ['ledger-viewer', 'ledger-stream', 'ledger-kind'])
    byId(id).addEventListener(id === 'ledger-viewer' ? 'input' : 'change', () => {
      visibleCredits = 100;
      showCredits();
    });
  byId('more-credits').addEventListener('click', () => {
    visibleCredits += 100;
    showCredits();
  });
  for (const id of ['copy-credits', 'download-credits'])
    byId(id).addEventListener('click', async () => {
      try {
        if (!(await loadLedger(true))) throw new Error('Saved history needs the updated server.');
        const records = selectedCredits();
        if (id === 'copy-credits') {
          const text = ledgerAsText(records);
          try {
            await navigator.clipboard.writeText(text);
          } catch {
            byId('credits-copy').value = text;
            byId('credits-copy').hidden = false;
            byId('credits-copy').select();
          }
          byId('ledger-message').textContent =
            'Current filtered credits copied. Select and copy the text below if clipboard access is unavailable.';
        } else {
          const url = URL.createObjectURL(
            new Blob([ledgerAsCsv(records)], { type: 'text/csv;charset=utf-8' }),
          );
          const link = document.createElement('a');
          link.href = url;
          link.download = 'credits.csv';
          link.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
          byId('ledger-message').textContent = 'Current filtered credits downloaded as CSV.';
        }
      } catch (error) {
        byId('ledger-message').textContent = error.message;
      }
    });
  await refresh();
  setInterval(() => {
    void refresh();
  }, 1000);
}

if (typeof document !== 'undefined') await startDashboard();
