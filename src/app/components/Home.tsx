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

  return (
    <div className="h-dvh relative overflow-hidden bg-(--bg)">
      <div className="flex h-18 w-full px-6 items-center justify-end fixed top-0 left-0">
        <ThemeButton theme={theme} setTheme={setTheme} />
      </div>
      <div className="h-full pt-18 flex-1 flex flex-col">{children}</div>
    </div>
  );
}
