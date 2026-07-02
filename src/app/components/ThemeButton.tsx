import React, { useEffect, Dispatch, SetStateAction } from "react";
import { Sun, Moon } from "lucide-react";

interface ThemeControlsProps {
  theme: string;
  setTheme: Dispatch<SetStateAction<string>>;
}

export default function ThemeButton({ theme, setTheme }: ThemeControlsProps) {
  useEffect(() => {
    document.documentElement.className = theme; // apply the theme class to the HTML element
  }, [theme]);

  return (
    <button onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
      <div className="flex cursor-pointer flex-row overflow-hidden rounded-lg border-2 border-(--border)">
        <div className="flex bg-transparent p-2 in-[.light]:bg-(--bg2)">
          <Sun />
        </div>

        <div className="w-0.5 bg-(--border)" />

        <div className="flex bg-transparent p-2 in-[.dark]:bg-(--bg2)">
          <Moon />
        </div>
      </div>
    </button>
  );
}
