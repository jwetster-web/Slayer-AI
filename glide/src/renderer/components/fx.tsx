import { useEffect, useRef } from 'react';
import { usePrefersReducedMotion } from '../lib/hooks';

/** Ambient constellation field. Low-cost canvas; freezes under reduced motion. */
export function ParticleField({ density = 0.00009, className }: { density?: number; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const reduced = usePrefersReducedMotion();
  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext('2d')!;
    let raf = 0;
    let w = 0;
    let h = 0;
    let pts: { x: number; y: number; vx: number; vy: number; r: number; a: number }[] = [];
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const n = Math.min(160, Math.round(w * h * density));
      pts = Array.from({ length: n }, () => ({ x: Math.random() * w, y: Math.random() * h, vx: (Math.random() - 0.5) * 0.12, vy: (Math.random() - 0.5) * 0.12, r: Math.random() * 1.3 + 0.3, a: Math.random() * 0.6 + 0.2 }));
    };
    const draw = () => {
      ctx.clearRect(0, 0, w, h);
      const light = document.documentElement.dataset.theme === 'light';
      const c = light ? '40,60,140' : '170,190,255';
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        if (!reduced) {
          p.x += p.vx;
          p.y += p.vy;
          if (p.x < 0) p.x = w;
          if (p.x > w) p.x = 0;
          if (p.y < 0) p.y = h;
          if (p.y > h) p.y = 0;
        }
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${c},${p.a * (light ? 0.5 : 1)})`;
        ctx.fill();
        for (let j = i + 1; j < pts.length; j++) {
          const q = pts[j];
          const dx = p.x - q.x;
          const dy = p.y - q.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < 110 * 110) {
            ctx.strokeStyle = `rgba(${c},${(1 - Math.sqrt(d2) / 110) * 0.12})`;
            ctx.lineWidth = 0.6;
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(q.x, q.y);
            ctx.stroke();
          }
        }
      }
      if (!reduced) raf = requestAnimationFrame(draw);
    };
    resize();
    draw();
    const ro = new ResizeObserver(() => {
      resize();
      if (reduced) draw();
    });
    ro.observe(canvas);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [density, reduced]);
  return <canvas ref={ref} className={className ?? 'pointer-events-none absolute inset-0 size-full'} aria-hidden />;
}

/** Soft aurora blobs behind the app. */
export function Aurora() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      <div className="absolute -left-40 -top-40 size-[640px] rounded-full bg-accent opacity-[0.10] blur-[120px]" />
      <div className="absolute -right-32 top-1/4 size-[560px] rounded-full bg-violet opacity-[0.10] blur-[120px]" />
      <div className="absolute bottom-[-200px] left-1/3 size-[620px] rounded-full bg-cyan opacity-[0.06] blur-[130px]" />
      <div className="absolute inset-0 opacity-[0.035]" style={{ backgroundImage: 'linear-gradient(var(--g-ink) 1px, transparent 1px), linear-gradient(90deg, var(--g-ink) 1px, transparent 1px)', backgroundSize: '56px 56px', maskImage: 'radial-gradient(ellipse at 50% 30%, black 20%, transparent 75%)' }} />
    </div>
  );
}
