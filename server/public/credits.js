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
