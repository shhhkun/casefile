"use client";

import React, { useState, useEffect, ReactNode } from "react";

import ThemeButton from "./ThemeButton";

export default function Home({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState(() => {
    if (typeof window !== "undefined") {
      return window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
    }
    return "dark";
  });

  useEffect(() => {
    document.documentElement.classList.remove("light", "dark");
    document.documentElement.classList.add(theme);
  }, [theme]);

  return (
    <div className="relative h-dvh overflow-hidden bg-(--bg)">
      <div className="fixed top-0 left-0 flex h-18 w-full items-center justify-end px-6">
        <ThemeButton theme={theme} setTheme={setTheme} />
      </div>
      <div className="flex h-full flex-1 flex-col pt-18">{children}</div>
    </div>
  );
}
