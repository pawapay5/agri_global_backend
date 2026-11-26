"use client";
import { ChevronLeft, ChevronRight, Pause, Play } from "lucide-react";
import Image, { type StaticImageData } from "next/image";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import c1 from "../../../public/images/carousel_1.jpeg";
import c2 from "../../../public/images/carousel_2.jpeg";
import c3 from "../../../public/images/carousel_3.jpeg";
import c4 from "../../../public/images/carousel_4.jpg";
import c5 from "../../../public/images/carousel_5.jpg";
import { cn } from "@/lib/utils";

const SLIDES: StaticImageData[] = [c1, c2, c3, c4, c5];
const INTERVAL_MS = 6000;

/** Index after a step, wrapping both ways (exported for tests). */
export const wrap = (i: number, n: number) => ((i % n) + n) % n;

export function HeroCarousel({ children }: { children: ReactNode }) {
  const t = useTranslations("home");
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [held, setHeld] = useState(false); // hover / focus / hidden tab
  const touchX = useRef<number | null>(null);
  const n = SLIDES.length;
  const go = useCallback((i: number) => setIndex(wrap(i, n)), [n]);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (mq.matches) setPlaying(false); // eslint-disable-line react-hooks/set-state-in-effect -- one-time read of a media query
    const onVis = () => setHeld(document.visibilityState !== "visible");
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);
  useEffect(() => {
    if (!playing || held) return;
    const id = setTimeout(() => setIndex((i) => wrap(i + 1, n)), INTERVAL_MS);
    return () => clearTimeout(id);
  }, [playing, held, index, n]);

  return (
    <section
      aria-roledescription="carousel" aria-label={t("carousel")}
      className="relative isolate overflow-hidden bg-hero text-white"
      onMouseEnter={() => setHeld(true)} onMouseLeave={() => setHeld(false)}
      onFocusCapture={() => setHeld(true)} onBlurCapture={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setHeld(false); }}
      onKeyDown={(e) => { if (e.key === "ArrowRight") go(document.dir === "rtl" ? index - 1 : index + 1); if (e.key === "ArrowLeft") go(document.dir === "rtl" ? index + 1 : index - 1); }}
      onTouchStart={(e) => { touchX.current = e.touches[0]?.clientX ?? null; }}
      onTouchEnd={(e) => { const x0 = touchX.current; const x1 = e.changedTouches[0]?.clientX; touchX.current = null; if (x0 == null || x1 == null || Math.abs(x1 - x0) < 40) return; go(x1 < x0 ? index + 1 : index - 1); }}
    >
      <div aria-live={playing && !held ? "off" : "polite"} className="absolute inset-0 -z-10">
        {SLIDES.map((src, i) => (
          <div key={i} role="group" aria-roledescription="slide" aria-label={t("slide", { n: i + 1, total: n })} aria-hidden={i !== index}
            className={cn("absolute inset-0 transition-opacity duration-1000 ease-out", i === index ? "opacity-100" : "opacity-0")}>
            <Image src={src} alt={t(`alt${i + 1}`)} fill sizes="100vw" placeholder="blur" priority={i === 0} loading={i === 0 ? "eager" : "lazy"}
              className={cn("object-cover motion-safe:transition-transform motion-safe:duration-[7000ms] motion-safe:ease-out", i === index ? "motion-safe:scale-105" : "scale-100")} />
          </div>
        ))}
        {/* Two scrims: a left-to-right one for the headline, a bottom one for the caption and controls. */}
        <div aria-hidden className="absolute inset-0 bg-gradient-to-r from-black/80 via-black/55 to-black/15 rtl:bg-gradient-to-l" />
        <div aria-hidden className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-black/70 to-transparent" />
      </div>

      {children}

      <div className="mx-auto flex max-w-7xl flex-wrap items-end justify-between gap-4 px-4 pb-6">
        <p className="min-h-6 text-sm font-medium text-white/90" aria-hidden>
          <span className="me-2 inline-block h-0.5 w-6 translate-y-[-3px] bg-leaf align-middle" />{t(`cap${index + 1}`)}
        </p>
        <div className="flex items-center gap-1.5">
          <button type="button" onClick={() => setPlaying((p) => !p)} aria-label={playing ? t("pause") : t("play")} className="grid size-9 place-items-center rounded-full bg-white/15 backdrop-blur hover:bg-white/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white">
            {playing ? <Pause aria-hidden className="size-4" /> : <Play aria-hidden className="size-4" />}
          </button>
          <button type="button" onClick={() => go(index - 1)} aria-label={t("prev")} className="grid size-9 place-items-center rounded-full bg-white/15 backdrop-blur hover:bg-white/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"><ChevronLeft aria-hidden className="size-4 rtl:rotate-180" /></button>
          <ul className="flex items-center gap-1 px-1">
            {SLIDES.map((_, i) => (
              <li key={i}><button type="button" onClick={() => go(i)} aria-label={t("goTo", { n: i + 1 })} aria-current={i === index ? "true" : undefined}
                className="grid h-9 w-6 place-items-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white rounded-full">
                <span className={cn("block h-1.5 rounded-full bg-white transition-all duration-500", i === index ? "w-6" : "w-1.5 opacity-50")} />
              </button></li>
            ))}
          </ul>
          <button type="button" onClick={() => go(index + 1)} aria-label={t("next")} className="grid size-9 place-items-center rounded-full bg-white/15 backdrop-blur hover:bg-white/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"><ChevronRight aria-hidden className="size-4 rtl:rotate-180" /></button>
        </div>
      </div>
      {/* Progress bar for the current slide (decorative; restarts on every change). */}
      {playing && !held ? <div key={index} aria-hidden className="absolute inset-x-0 bottom-0 h-0.5 origin-left bg-leaf motion-safe:animate-[carousel-progress_6s_linear_forwards] rtl:origin-right" /> : null}
    </section>
  );
}
