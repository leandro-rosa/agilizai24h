"use client";

import { AlertDialog as AlertDialogPrimitive } from "radix-ui";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

type ConfirmDialogProps = {
  /** The element that opens the dialog (usually an icon button). */
  trigger: React.ReactNode;
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  /** Red confirm button — for deletes and anything that overwrites data. */
  destructive?: boolean;
  /** Toast shown when `onConfirm` resolves. */
  successMessage?: string;
  /** Throw (or return a rejected promise, e.g. `mutation().unwrap()`) to show the error toast. */
  onConfirm: () => unknown | Promise<unknown>;
};

/**
 * One confirmation step for every destructive or wide-reaching action, so a
 * misclick on a row icon never deletes ledger data. Always reports the
 * outcome with a toast, because direct mutation calls swallowed failures.
 */
export function ConfirmDialog({
  trigger,
  title,
  description,
  confirmLabel = "Confirmar",
  destructive = false,
  successMessage,
  onConfirm,
}: ConfirmDialogProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleConfirm() {
    setBusy(true);
    try {
      await onConfirm();
      if (successMessage) toast.success(successMessage);
      setOpen(false);
    } catch {
      toast.error("Não foi possível concluir a ação. Tente novamente.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AlertDialogPrimitive.Root open={open} onOpenChange={(next) => !busy && setOpen(next)}>
      <AlertDialogPrimitive.Trigger asChild>{trigger}</AlertDialogPrimitive.Trigger>
      <AlertDialogPrimitive.Portal>
        <AlertDialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <AlertDialogPrimitive.Content className="fixed top-1/2 left-1/2 z-50 grid w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 gap-4 rounded-lg border bg-background p-6 shadow-lg">
          <AlertDialogPrimitive.Title className="text-lg font-semibold">{title}</AlertDialogPrimitive.Title>
          <AlertDialogPrimitive.Description asChild>
            <div className="text-sm text-muted-foreground">{description}</div>
          </AlertDialogPrimitive.Description>
          <div className="flex justify-end gap-2">
            <AlertDialogPrimitive.Cancel asChild>
              <Button variant="outline" disabled={busy}>
                Cancelar
              </Button>
            </AlertDialogPrimitive.Cancel>
            <Button variant={destructive ? "destructive" : "default"} disabled={busy} onClick={handleConfirm}>
              {busy ? "Aguarde…" : confirmLabel}
            </Button>
          </div>
        </AlertDialogPrimitive.Content>
      </AlertDialogPrimitive.Portal>
    </AlertDialogPrimitive.Root>
  );
}
