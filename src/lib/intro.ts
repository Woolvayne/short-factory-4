/** One canvas implementation for both live preview and the actual encoded video. */
export interface IntroPose { x: number; y: number; rotation: number; scale: number; alpha: number }
export function introPose(time: number, duration: number): IntroPose | null {
  if (!Number.isFinite(time) || !Number.isFinite(duration) || duration <= 0 || time < 0 || time >= duration) return null;
  const enter = Math.min(1, time / Math.min(0.55, duration * 0.25));
  const exit = Math.max(0, (time - duration + Math.min(0.4, duration * 0.25)) / Math.min(0.4, duration * 0.25));
  const ease = 1 - Math.pow(1 - enter, 3);
  return { x: -(1 - ease) * 1.2 + exit * exit * 1.3, y: (1 - ease) * 0.12 - exit * 0.05, rotation: -(1 - ease) * 0.14 + exit * 0.1, scale: 0.9 + 0.1 * ease, alpha: Math.min(1, enter * 3) * (1 - exit) };
}
function wrap(ctx: CanvasRenderingContext2D, text: string, width: number) {
  const lines: string[] = [];
  let line = '';
  // Character-level fallback also handles titles without spaces and very long words.
  for (const word of text.trim().split(/\s+/)) {
    if (ctx.measureText(`${line} ${word}`.trim()).width <= width) { line = `${line} ${word}`.trim(); continue; }
    if (line) lines.push(line);
    line = '';
    for (const char of word) {
      if (line && ctx.measureText(line + char).width > width) { lines.push(line); line = ''; }
      line += char;
    }
  }
  if (line) lines.push(line);
  return lines;
}
export function drawIntroCard(ctx: CanvasRenderingContext2D, title: string, w: number, h: number, time: number, duration: number) {
  const pose = introPose(time, duration);
  if (!pose) return;
  const cardW = w * 0.84;
  const pad = w * 0.05;
  let font = w * 0.055;
  let lines: string[] = [];
  const safeTitle = (title.trim() || 'You won’t believe how this story ends…').slice(0, 400);
  do {
    ctx.font = `800 ${font}px Arial, Helvetica, sans-serif`;
    lines = wrap(ctx, safeTitle, cardW - pad * 2);
    if (lines.length * font * 1.2 <= h * 0.24) break;
    font -= w * 0.002;
  } while (font > w * 0.025);
  const maxLines = Math.max(1, Math.floor(h * 0.24 / (font * 1.2)));
  if (lines.length > maxLines) { lines = lines.slice(0, maxLines); lines[maxLines - 1] = lines[maxLines - 1].slice(0, -2) + '…'; }
  const headerH = w * 0.10;
  const cardH = pad * 2 + headerH + lines.length * font * 1.2 + w * 0.065;
  ctx.save();
  ctx.globalAlpha = pose.alpha;
  ctx.translate(w * 0.5 + pose.x * w, h * (0.37 + pose.y));
  ctx.rotate(pose.rotation); ctx.scale(pose.scale, pose.scale);
  const left = -cardW / 2, top = -cardH / 2;
  ctx.shadowColor = 'rgba(0,0,0,.35)'; ctx.shadowBlur = w * 0.045; ctx.shadowOffsetY = w * 0.02;
  ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.roundRect(left, top, cardW, cardH, w * 0.028); ctx.fill();
  ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
  const x = left + pad, y = top + pad;
  ctx.fillStyle = '#ff5722'; ctx.beginPath(); ctx.arc(x + w * 0.027, y + w * 0.027, w * 0.027, 0, Math.PI * 2); ctx.fill();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#fff'; ctx.font = `900 ${w * 0.032}px Arial`; ctx.fillText('s', x + w * 0.027, y + w * 0.027);
  ctx.textAlign = 'left'; ctx.fillStyle = '#161b22'; ctx.font = `700 ${w * 0.025}px Arial`; ctx.fillText('r / storytime', x + w * 0.075, y + w * 0.015);
  ctx.fillStyle = '#737780'; ctx.font = `500 ${w * 0.018}px Arial`; ctx.fillText('A STORY WORTH STAYING FOR', x + w * 0.075, y + w * 0.045);
  ctx.fillStyle = '#15171b'; ctx.font = `800 ${font}px Arial, Helvetica, sans-serif`; ctx.textBaseline = 'top';
  lines.forEach((line, i) => ctx.fillText(line, x, y + headerH + i * font * 1.2));
  ctx.fillStyle = '#f0f1f3'; ctx.beginPath(); ctx.roundRect(x, top + cardH - pad - w * 0.034, w * 0.24, w * 0.04, w * 0.02); ctx.fill();
  ctx.fillStyle = '#575b65'; ctx.font = `700 ${w * 0.018}px Arial`; ctx.textBaseline = 'middle'; ctx.fillText('STAY FOR THE TWIST', x + w * 0.018, top + cardH - pad - w * 0.014);
  ctx.restore();
}
