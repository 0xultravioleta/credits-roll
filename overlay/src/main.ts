import './style.css';
import type { OverlayEvent } from '../../server/src/events/protocol.js';
import { OverlayModel, POPUP_MS } from './state.js';
import { layoutCredits } from './credits.js';

const canvas = document.querySelector<HTMLCanvasElement>('#overlay')!;
const ctx = canvas.getContext('2d')!;
const announcement = document.querySelector<HTMLDivElement>('#announcement')!;
const params = new URLSearchParams(location.search);
const preview = params.has('preview');
const forceCredits = params.get('view') === 'credits';
if (preview) document.body.classList.add('preview');
const model = new OverlayModel();
const W = 1920;
const H = 1080;
const color = { paper: '#f2efe7', muted: '#a39ca9', green: '#d8ef8c', lilac: '#c3a9ec' };
let lastAnnouncement = '';
let manualCreditsAt = performance.now();

function resize() {
  const ratio = Math.min(devicePixelRatio || 1, 2);
  canvas.width = W * ratio;
  canvas.height = H * ratio;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
}
resize();
window.addEventListener('resize', resize);

function label(text: string, x: number, y: number, fill = color.muted, size = 15, tracking = 3) {
  ctx.fillStyle = fill;
  ctx.font = `500 ${size}px Arial`;
  ctx.textAlign = 'left';
  for (const char of text) {
    ctx.fillText(char, x, y);
    x += ctx.measureText(char).width + tracking;
  }
}

function line(x: number, y: number, width: number, fill = '#3e3647') {
  ctx.fillStyle = fill;
  ctx.fillRect(x, y, width, 1);
}

function wrap(text: string, maxWidth: number, maxLines: number): string[] {
  const lines: string[] = [];
  let current = '';
  for (const char of text.replace(/\s+/g, ' ').trim()) {
    if (ctx.measureText(current + char).width > maxWidth) {
      lines.push(current.trim());
      current = '';
    }
    current += char;
  }
  if (current.trim()) lines.push(current.trim());
  if (lines.length > maxLines) {
    lines.length = maxLines;
    lines[maxLines - 1] = `${lines[maxLines - 1]?.slice(0, -2)}…`;
  }
  return lines;
}

function previewStage(now: number) {
  const background = ctx.createLinearGradient(0, 0, W, H);
  background.addColorStop(0, '#151219');
  background.addColorStop(0.55, '#1c1724');
  background.addColorStop(1, '#30223b');
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = '#ffffff07';
  ctx.lineWidth = 1;
  for (let x = 0; x < W; x += 80) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
    ctx.stroke();
  }
  for (let y = 0; y < H; y += 80) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }
  label('CREDITS / ROLL', 90, 92, color.paper, 23, 4);
  ctx.fillStyle = model.connected ? color.green : color.muted;
  ctx.beginPath();
  ctx.arc(1550, 85, 5 + Math.sin(now / 650) * 0.8, 0, Math.PI * 2);
  ctx.fill();
  label(model.connected ? 'REHEARSAL CONNECTED' : 'CONNECTING', 1570, 91, color.green, 13, 2);
  line(90, 135, 1740);
  label('THE STREAM WAS A GROUP PROJECT.', 90, 252, color.green, 15, 4);
  ctx.fillStyle = color.paper;
  ctx.font = '500 116px Arial';
  ctx.textAlign = 'left';
  ctx.fillText('One stream.', 80, 408);
  ctx.fillText('A whole', 80, 533);
  ctx.fillStyle = color.lilac;
  ctx.fillText('supporting cast.', 80, 658);
  ctx.font = '25px Arial';
  ctx.fillStyle = color.muted;
  ctx.fillText('The people who moved the story deserve a place in it.', 90, 723);
  line(1330, 240, 1);
  const cards = [
    ['01', 'THE IDEA', 'That changed the run.'],
    ['02', 'THE ASSIST', 'That saved the day.'],
    ['03', 'THE RIFF', 'That became the bit.'],
  ];
  cards.forEach(([number, title, detail], index) => {
    const y = 282 + index * 145;
    label(number!, 1370, y, color.lilac, 16, 2);
    label(title!, 1430, y, color.paper, 16, 3);
    ctx.font = '21px Georgia';
    ctx.fillStyle = color.muted;
    ctx.fillText(detail!, 1430, y + 40);
    line(1370, y + 78, 400);
  });
  label('LIVE RECOGNITION  /  END CREDITS  /  A LITTLE EXTRA LUCK', 90, 1012, color.muted, 13, 2);
}

function popup(now: number) {
  const active = model.current;
  if (!active) return;
  const age = now - active.startedAt;
  const opacity = Math.min(1, age / 300, (POPUP_MS - age) / 500);
  ctx.save();
  ctx.globalAlpha = Math.max(0, opacity);
  const x = 80;
  const y = 810 + (1 - opacity) * 25;
  const width = 1160;
  ctx.shadowColor = '#00000066';
  ctx.shadowBlur = 32;
  ctx.fillStyle = '#1a1623f5';
  ctx.beginPath();
  ctx.roundRect(x, y, width, 180, 12);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = color.green;
  ctx.fillRect(x, y + 20, 4, 140);
  label(
    `CREDIT WHERE IT'S DUE  /  ${active.moment.kind.toUpperCase()}`,
    x + 32,
    y + 34,
    color.green,
    12,
    2,
  );
  ctx.fillStyle = color.paper;
  ctx.font = '500 31px Arial';
  ctx.textAlign = 'left';
  const title = `@${active.moment.viewer.login} moved the stream:`;
  ctx.fillText(title, x + 32, y + 80);
  ctx.font = '27px Georgia';
  ctx.fillStyle = color.lilac;
  wrap(active.moment.quote, width - 72, 2).forEach((text, index) =>
    ctx.fillText(text, x + 32, y + 122 + index * 33),
  );
  ctx.fillStyle = '#d8ef8c66';
  ctx.fillRect(x + 20, y + 174, (width - 40) * (1 - age / POPUP_MS), 2);
  ctx.restore();
  if (lastAnnouncement !== active.moment.id) {
    announcement.textContent = `${title} ${active.moment.quote}`;
    lastAnnouncement = active.moment.id;
  }
}

function credits(now: number) {
  const elapsed =
    Math.max(0, now - (forceCredits ? manualCreditsAt : model.creditsStartedAt)) / 1000;
  ctx.fillStyle = '#101013';
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(960, 500, 0, 960, 500, 900);
  glow.addColorStop(0, '#2b203b80');
  glow.addColorStop(1, '#10101300');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);
  ctx.font = '24px Georgia';
  const layout = layoutCredits(model.credits, (quote) => wrap(quote, 1500, Infinity));
  const offset = Math.max(H * 0.62 - elapsed * 85, -layout.contentHeight + H / 2);
  ctx.save();
  ctx.translate(0, offset);
  ctx.textAlign = 'center';
  ctx.font = '20px Arial';
  ctx.fillStyle = color.green;
  ctx.fillText('THE STREAM WAS A GROUP PROJECT.', W / 2, 0);
  ctx.font = '110px Georgia';
  ctx.fillStyle = color.paper;
  ctx.fillText('Credits Roll', W / 2, 145);
  ctx.font = 'italic 29px Georgia';
  ctx.fillStyle = color.lilac;
  ctx.fillText('A stream by one. A story by everyone.', W / 2, 215);
  ctx.font = '16px Arial';
  ctx.fillStyle = color.muted;
  ctx.fillText('THE PEOPLE WHO MOVED THE STREAM', W / 2, 330);
  if (model.credits.length === 0) {
    ctx.font = '30px Georgia';
    ctx.fillStyle = color.paper;
    ctx.fillText('Your supporting cast is still being written.', W / 2, 460);
  }
  const roles = {
    idea: 'IDEAS THAT CHANGED THE RUN',
    assist: 'ASSISTS THAT SAVED THE DAY',
    riff: 'RIFFS THAT BECAME THE BIT',
  };
  layout.rows.forEach(({ entry, y, quoteLines }) => {
    ctx.font = '13px Arial';
    ctx.fillStyle = color.lilac;
    ctx.fillText(entry.kinds.map((kind) => roles[kind]).join('  /  '), W / 2, y);
    ctx.font = '52px Georgia';
    ctx.fillStyle = color.paper;
    ctx.fillText(`@${entry.viewer.login}`, W / 2, y + 62);
    const weight = model.wheel.find((row) => row.viewer.id === entry.viewer.id)?.weight ?? 0;
    ctx.font = '17px Arial';
    ctx.fillStyle = color.muted;
    ctx.fillText(
      `${entry.momentCount} moment${entry.momentCount === 1 ? '' : 's'}  ·  ${entry.points} reputation  ·  ${weight}× wheel weight`,
      W / 2,
      y + 100,
    );
    ctx.font = '24px Georgia';
    ctx.fillStyle = color.lilac;
    quoteLines.forEach((text, index) => ctx.fillText(text, W / 2, y + 140 + index * 32));
  });
  const end = layout.end;
  ctx.fillStyle = color.green;
  ctx.fillRect(W / 2 - 30, end, 60, 2);
  ctx.font = '54px Georgia';
  ctx.fillStyle = color.paper;
  ctx.fillText('You made this stream.', W / 2, end + 120);
  ctx.font = '22px Georgia';
  ctx.fillStyle = color.muted;
  ctx.fillText('See you in the next one.', W / 2, end + 175);
  ctx.restore();
  const fade = ctx.createLinearGradient(0, 0, 0, H);
  fade.addColorStop(0, '#101013');
  fade.addColorStop(0.14, '#10101300');
  fade.addColorStop(0.86, '#10101300');
  fade.addColorStop(1, '#101013');
  ctx.fillStyle = fade;
  ctx.fillRect(0, 0, W, H);
  label('CREDITS / ROLL', 80, 66, color.muted, 13, 3);
  label('WITH CHAT. ALWAYS.', 1580, 66, color.muted, 13, 2);
}

function frame(now: number) {
  model.tick(now);
  ctx.clearRect(0, 0, W, H);
  if (model.phase === 'credits' || forceCredits) credits(now);
  else {
    if (preview) previewStage(now);
    popup(now);
  }
  if (!model.current && model.phase !== 'credits' && lastAnnouncement) {
    announcement.textContent = '';
    lastAnnouncement = '';
  }
  requestAnimationFrame(frame);
}

const source = new EventSource('/events');
source.onopen = () => {
  model.connected = true;
};
source.onerror = () => {
  model.connected = false;
};
source.addEventListener('overlay', (event: MessageEvent<string>) => {
  try {
    const data = JSON.parse(event.data) as OverlayEvent;
    model.accept(data, performance.now());
    if (data.type === 'snapshot' && data.state.phase === 'credits') {
      announcement.textContent = `End credits: ${data.state.credits.map((entry) => `@${entry.viewer.login}: ${(entry.quotes ?? []).map((quote) => quote.text).join('; ')}`).join(', ')}`;
      if (forceCredits) manualCreditsAt = performance.now();
    }
    if (data.type === 'optout' || data.type === 'reset') announcement.textContent = '';
  } catch {
    /* Ignore malformed data; never insert server text into HTML. */
  }
});
window.addEventListener('pagehide', () => source.close());
requestAnimationFrame(frame);
