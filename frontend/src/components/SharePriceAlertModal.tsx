"use client";

import React, { useEffect } from "react";
import SharePriceAlertPanel from "./SharePriceAlertPanel";

interface SharePriceAlertModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentPrice?: number;
}

export default function SharePriceAlertModal({
  isOpen,
  onClose,
  currentPrice,
}: SharePriceAlertModalProps) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="price-alert-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200"
    >
      <div
        className="fixed inset-0"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="relative z-10 w-full max-w-md">
        <SharePriceAlertPanel
          isModal={true}
          onClose={onClose}
          currentPrice={currentPrice}
        />
      </div>
    </div>
  );
}
