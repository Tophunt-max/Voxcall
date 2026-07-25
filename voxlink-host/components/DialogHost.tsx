import React, { useEffect, useState, useCallback } from "react";
import { ConfirmModal } from "@/components/ConfirmModal";
import { _setDialogHost, type DialogRequest } from "@/utils/dialog";

/**
 * Single global host for app-wide themed dialogs. Mount once at the app root.
 * confirmDialog()/alertDialog() (utils/dialog.ts) push requests here so every
 * confirmation/alert renders the branded ConfirmModal on web + native.
 */
export function DialogHost() {
  const [req, setReq] = useState<DialogRequest | null>(null);

  useEffect(() => {
    _setDialogHost((r) => setReq(r));
    return () => _setDialogHost(null);
  }, []);

  const handleConfirm = useCallback(() => {
    const fn = req?.onConfirm;
    // Close first so a follow-up dialog opened inside onConfirm (e.g. the
    // delete-account double confirm) can take the slot.
    setReq(null);
    if (fn) void fn();
  }, [req]);

  const handleCancel = useCallback(() => {
    const fn = req?.onCancel;
    setReq(null);
    fn?.();
  }, [req]);

  if (!req) return null;

  return (
    <ConfirmModal
      visible
      title={req.title}
      message={req.message}
      emoji={req.emoji}
      destructive={req.destructive}
      singleButton={req.kind === "alert"}
      confirmText={req.confirmText ?? (req.kind === "alert" ? "OK" : "Confirm")}
      cancelText={req.cancelText ?? "Cancel"}
      onConfirm={handleConfirm}
      onCancel={handleCancel}
    />
  );
}
