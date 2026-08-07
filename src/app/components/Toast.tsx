"use client";

import { useEffect } from "react";
import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";

export type ToastType = "error" | "success" | "info";

interface ToastProps {
  message: string;
  type?: ToastType;
  onClose: () => void;
  duration?: number;
}

const ICONS: Record<ToastType, React.ReactNode> = {
  error: <AlertTriangle size={18} />,
  success: <CheckCircle2 size={18} />,
  info: <Info size={18} />,
};

export default function Toast({
  message,
  type = "error",
  onClose,
  duration = 5000,
}: ToastProps) {
  useEffect(() => {
    const timer = setTimeout(onClose, duration);
    return () => clearTimeout(timer);
  }, [onClose, duration]);

  return (
    <div className="pointer-events-none fixed top-20 left-1/2 z-50 -translate-x-1/2">
      <div
        role="alert"
        className="pointer-events-auto flex items-center gap-3 rounded-lg border-2 border-(--border) bg-(--bg2) px-4 py-3 shadow-lg"
      >
        <span className="text-(--accent)">{ICONS[type]}</span>
        <p className="text-sm font-medium">{message}</p>
        <button
          onClick={onClose}
          aria-label="Dismiss"
          className="-m-1 cursor-pointer rounded-full p-1 transition-colors duration-200 hover:bg-(--bg)"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
