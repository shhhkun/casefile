"use client";

import React, { useState, useEffect, ReactNode } from "react";

export default function Home({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh relative overflow-hidden bg-(--bg)">
      <div className="fixed top-0 left-0 h-18 w-full bg-(--test)"></div>
      <div className="h-full pt-18 flex-1 flex flex-col">{children}</div>
    </div>
  );
}
