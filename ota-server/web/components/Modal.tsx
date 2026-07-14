import * as React from 'react';

export function Modal({ open, onClose, children }: { open: boolean; onClose: () => void; children: React.ReactNode }) {
  if (!open) return null;
  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      className="fadein fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-5 backdrop-blur-sm"
    >
      <div className="pop max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border border-border bg-gradient-to-b from-card to-card2 p-6 shadow-2xl">
        {children}
      </div>
    </div>
  );
}
