"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

type FullscreenLoaderProps = {
  title: string;
  description: string;
  steps?: string[];
};

export function FullscreenLoader({ title, description, steps }: FullscreenLoaderProps) {
  const [progress, setProgress] = useState(0);
  const [stepIndex, setStepIndex] = useState(0);

  // Animate progress bar: quick bursts that slow as it approaches 88%
  useEffect(() => {
    const schedule: [number, number][] = [
      [18, 180],
      [38, 480],
      [56, 900],
      [70, 1500],
      [80, 2200],
      [88, 3200],
    ];
    const timers = schedule.map(([target, delay]) =>
      setTimeout(() => setProgress(target), delay),
    );
    return () => timers.forEach(clearTimeout);
  }, []);

  // Cycle through step labels if provided
  useEffect(() => {
    if (!steps || steps.length <= 1) return;
    const interval = setInterval(() => {
      setStepIndex((i) => (i + 1) % steps.length);
    }, 1600);
    return () => clearInterval(interval);
  }, [steps]);

  const stepLabel = steps?.[stepIndex] ?? description;

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-[linear-gradient(160deg,hsl(214,40%,97%)_0%,hsl(214,35%,95%)_40%,white_80%)] px-6">
      <div className="flex w-full max-w-sm flex-col items-center">

        {/* Logo mark */}
        <div className="relative mb-8">
          <div className="flex size-16 items-center justify-center rounded-2xl border border-border/60 bg-white shadow-panel">
            <Image
              src="/logo.svg"
              alt="Gideon"
              width={44}
              height={44}
              className="h-10 w-auto object-contain"
              style={{ mixBlendMode: "multiply" }}
              priority
            />
          </div>
          {/* Slow pulse ring */}
          <span className="absolute -inset-1.5 rounded-[1.375rem] border-2 border-primary/15 animate-ping" style={{ animationDuration: "2.4s" }} />
        </div>

        {/* Title + cycling step */}
        <h1 className="text-base font-semibold text-foreground">{title}</h1>
        <p
          key={stepLabel}
          className="mt-1.5 text-sm text-muted-foreground transition-opacity duration-300"
        >
          {stepLabel}
        </p>

        {/* Progress bar */}
        <div className="mt-8 h-1 w-full overflow-hidden rounded-full bg-border/60">
          <div
            className="h-full rounded-full bg-primary/70 transition-[width] duration-700 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>

        {/* Bouncing dots */}
        <div className="mt-5 flex items-center gap-1.5">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="size-1.5 rounded-full bg-primary/40 animate-bounce"
              style={{ animationDelay: `${i * 160}ms`, animationDuration: "0.9s" }}
            />
          ))}
        </div>

      </div>
    </main>
  );
}
