"use client";

import { motion, useReducedMotion } from "framer-motion";

export function HeroAmbientOrbs() {
  const reduceMotion = useReducedMotion();

  if (reduceMotion) {
    return (
      <div
        className="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]"
        aria-hidden
      >
        <div className="absolute -left-24 top-0 h-64 w-64 rounded-full bg-[hsl(var(--glow-1)/0.35)] blur-3xl" />
        <div className="absolute right-0 top-24 h-56 w-56 rounded-full bg-[hsl(var(--glow-2)/0.28)] blur-3xl" />
      </div>
    );
  }

  return (
    <div
      className="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]"
      aria-hidden
    >
      <motion.div
        className="absolute -left-24 top-0 h-72 w-72 rounded-full bg-[hsl(var(--glow-1)/0.4)] blur-3xl dark:bg-[hsl(var(--glow-1)/0.22)]"
        animate={{ y: [0, 14, 0], opacity: [0.55, 0.75, 0.55] }}
        transition={{ duration: 14, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        className="absolute right-[-10%] top-16 h-64 w-64 rounded-full bg-[hsl(var(--glow-2)/0.32)] blur-3xl dark:bg-[hsl(var(--glow-2)/0.18)]"
        animate={{ y: [0, -18, 0], opacity: [0.45, 0.65, 0.45] }}
        transition={{
          duration: 18,
          repeat: Infinity,
          ease: "easeInOut",
          delay: 1,
        }}
      />
      <motion.div
        className="absolute bottom-[-20%] left-1/3 h-80 w-80 -translate-x-1/2 rounded-full bg-[hsl(var(--glow-3)/0.22)] blur-3xl dark:bg-[hsl(var(--glow-3)/0.12)]"
        animate={{ scale: [1, 1.05, 1] }}
        transition={{ duration: 20, repeat: Infinity, ease: "easeInOut" }}
      />
    </div>
  );
}
