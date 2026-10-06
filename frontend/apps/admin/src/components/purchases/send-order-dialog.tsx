"use client";

import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useGetEmailPreviewQuery, useSendOrderEmailMutation, type Purchase } from "@/lib/api/purchases";
import { orderPdfBase64 } from "@/lib/purchases/order-pdf";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Envio do pedido ao fornecedor. Nada sai antes de a pessoa conferir a prévia e confirmar; um pedido já enviado só sai de novo se ela
 * pedir ("enviar de novo"); se o envio falhar, o pedido fica onde estava e a falha fica registrada.
 */
export function SendOrderDialog({ order, open, onOpenChange }: { order: Purchase; open: boolean; onOpenChange: (open: boolean) => void }) {
  const [message, setMessage] = useState<string | null>(null);
  const [debounced, setDebounced] = useState<string | undefined>(undefined);
  const preview = useGetEmailPreviewQuery({ id: order.id, message: debounced }, { skip: !open });
  const [send, { isLoading: sending }] = useSendOrderEmailMutation();

  const [typedTo, setTo] = useState<string | null>(null);
  const [saveToSupplier, setSaveToSupplier] = useState(false);
  const [attach, setAttach] = useState(true);
  const [resend, setResend] = useState(false);

  const data = preview.data;
  // Endereço do cadastro do fornecedor como ponto de partida, editável.
  const to = typedTo ?? data?.to ?? "";
  const text = message ?? data?.default_message ?? "";

  // A prévia se atualiza com o texto digitado (com uma pausa, para não pedir a cada tecla).
  useEffect(() => {
    if (message === null) return;
    const timer = setTimeout(() => setDebounced(message), 500);
    return () => clearTimeout(timer);
  }, [message]);

  const validTo = EMAIL.test(to.trim());
  const blocked = !data?.configured || !validTo || (data.already_sent && !resend) || sending;

  async function confirm() {
    if (!data) return;
    try {
      const attachment = attach ? await orderPdfBase64(order, data.supplier_name ?? order.supplier_name ?? "") : undefined;
      await send({
        id: order.id,
        to: to.trim(),
        message: message ?? undefined,
        attachment_base64: attachment,
        attachment_name: data.attachment.suggested_filename,
        resend: resend || undefined,
        save_to_supplier: saveToSupplier || undefined,
      }).unwrap();
      toast.success(`Pedido enviado a ${to.trim()}.`);
      onOpenChange(false);
    } catch (failure) {
      toast.error((failure as { data?: { message?: string } })?.data?.message ?? "Não foi possível enviar o e-mail.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Enviar pedido ao fornecedor</DialogTitle>
          <DialogDescription>Confira o e-mail abaixo. Ele só é enviado quando você confirmar.</DialogDescription>
        </DialogHeader>

        {preview.isLoading && <p className="text-sm text-muted-foreground">Montando a prévia…</p>}
        {data && (
          <div className="flex flex-col gap-3">
            {!data.configured && (
              <p className="flex items-start gap-1 rounded-md border border-warning/40 p-2 text-sm" data-testid="not-configured">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
                <span>O envio de e-mail ainda não está configurado neste ambiente, então nada pode ser enviado. Quem administra o painel precisa informar o servidor de e-mail (SMTP).</span>
              </p>
            )}
            {data.already_sent && (
              <p className="rounded-md border border-warning/40 p-2 text-sm" data-testid="already-sent">
                Este pedido já foi enviado ({data.sent.filter((s) => s.result === "sent").length}×). Para enviar de novo, marque “Enviar de novo”.
              </p>
            )}
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Para
              <Input type="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder="email@fornecedor.com.br" aria-label="Destinatário" />
            </label>
            {!data.to && <p className="text-xs text-muted-foreground">Este fornecedor não tem e-mail cadastrado. Informe um endereço para enviar.</p>}
            <p className="text-sm">
              <span className="text-xs text-muted-foreground">Assunto: </span>
              {data.subject}
            </p>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Mensagem de abertura
              <Textarea value={text} onChange={(e) => setMessage(e.target.value)} rows={3} aria-label="Mensagem de abertura" />
            </label>
            <iframe title="Prévia do e-mail" sandbox="" srcDoc={data.html} className="h-64 w-full rounded-md border bg-white" />
            <div className="flex flex-wrap items-center gap-4 text-sm">
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={attach} onChange={(e) => setAttach(e.target.checked)} />
                Anexar o pedido em PDF ({data.attachment.suggested_filename})
              </label>
              {data.to !== to.trim() && validTo && (
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" checked={saveToSupplier} onChange={(e) => setSaveToSupplier(e.target.checked)} />
                  Guardar este e-mail no cadastro do fornecedor
                </label>
              )}
              {data.already_sent && (
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" checked={resend} onChange={(e) => setResend(e.target.checked)} />
                  Enviar de novo
                </label>
              )}
            </div>
            {data.sent.some((s) => s.result === "failed") && (
              <p className="text-xs text-muted-foreground">Tentativas anteriores com falha: {data.sent.filter((s) => s.result === "failed").map((s) => s.error).join("; ")}</p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={sending}>
            Cancelar
          </Button>
          <Button onClick={confirm} disabled={blocked}>
            {sending ? "Enviando..." : "Confirmar envio"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
