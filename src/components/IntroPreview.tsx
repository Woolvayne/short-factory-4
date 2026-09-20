import { useEffect, useRef } from 'react';
import { drawIntroCard } from '../lib/intro';
export default function IntroPreview({ duration, enabled }: { duration: number; enabled: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = canvas.current?.getContext('2d');
    if (!ctx) return;
    let frame = 0;
    const start = performance.now();
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const draw = () => {
      const w = 360, h = 640;
      const gradient = ctx.createLinearGradient(0, 0, w, h);
      gradient.addColorStop(0, '#233e43'); gradient.addColorStop(1, '#101814');
      ctx.fillStyle = gradient; ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = '#ffffff0c'; ctx.lineWidth = 1;
      for (let i = 0; i < h; i += 40) { ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(w, i - 100); ctx.stroke(); }
      const t = reduced ? duration * 0.5 : ((performance.now() - start) / 1000) % (duration + 1.2);
      if (enabled) drawIntroCard(ctx, 'My boss fired me. Then he found out who owned the company.', w, h, t, duration);
      ctx.font = '900 23px Arial'; ctx.textAlign = 'center'; ctx.fillStyle = '#fff';
      ctx.fillText('THEN HE REALIZED…', w / 2, h * 0.75);
      ctx.font = '11px monospace'; ctx.fillStyle = '#ffffff66'; ctx.fillText('INTRO PREVIEW · 9:16', w / 2, h - 30);
      if (!reduced) frame = requestAnimationFrame(draw);
    };
    draw(); return () => cancelAnimationFrame(frame);
  }, [duration, enabled]);
  return <canvas ref={canvas} width={360} height={640} aria-label="Animierte Vorschau der Intro-Titelkarte" className="mx-auto w-full max-w-[240px] rounded-xl border border-coal-600" />;
}
