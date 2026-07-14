import * as React from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

export function Drawer({
  open, onClose, title, children,
}: {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  children: React.ReactNode;
}) {
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    if (open) document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <>
      <div
        onClick={onClose}
        className={cn(
          'fixed inset-0 z-20 bg-black/60 backdrop-blur-[2px] transition-opacity duration-200',
          open ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
      />
      <div
        className={cn(
          'fixed right-0 top-0 z-30 h-screen w-[min(580px,94vw)] overflow-y-auto border-l border-border bg-card shadow-2xl transition-transform duration-200',
          open ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        <div className="glass sticky top-0 z-10 flex items-center justify-between border-b border-border px-5 py-4">
          <div className="font-mono text-sm font-semibold">{title}</div>
          <button onClick={onClose} className="text-muted-foreground transition-colors hover:text-foreground">
            <X size={18} />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </>
  );
}
