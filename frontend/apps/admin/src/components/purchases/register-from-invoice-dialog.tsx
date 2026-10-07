"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { CategoryFields, useNameClassification } from "@/components/products/category-fields";
import { useCreateProductFromInvoiceMutation, useGetCategoriesQuery, useGetNextSkuQuery, type Product } from "@/lib/api/products";
import { EMPTY_CLASSIFICATION, type ClassificationState } from "@/lib/products/taxonomy";
import { formatCents, formatDate } from "@/lib/purchases/money";
import { NewProductPriceStep } from "./new-product-price-step";

export interface InvoiceLineForRegistration {
  description: string;
  ean: string | null;
  /** Custo de UMA unidade, já convertido da embalagem. */
  unitCostCents: number;
  unitsPerPack: number;
  /** A unidade que a nota usa ("CX", "FD", "UN"). */
  purchaseUnit?: string | null;
}

export interface InvoiceForRegistration {
  number: string;
  issuedOn: string;
  supplierId: number;
  supplierName: string;
  /** A nota já entra recebida: o custo vale já no recebimento. Senão o custo só passa a valer ao receber. */
  received: boolean;
}

type ApiError = { data?: { message?: string; code?: string; sku?: string } };

/**
 * Cadastra, a partir de uma linha da nota, o produto que ainda não existe. O formulário já vem com o que a nota traz e pede só o que falta
 * (SKU sugerido, categoria, unidade de venda…). Não pergunta custo: o custo da nota vira o primeiro custo do produto no recebimento. Um EAN
 * que já é de outro produto não cria nada: diz de quem é e deixa a pessoa decidir. Depois de cadastrar, oferece o preço sugerido.
 */
export function RegisterFromInvoiceDialog({
  open,
  onOpenChange,
  line,
  invoice,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  line: InvoiceLineForRegistration;
  invoice: InvoiceForRegistration;
  onCreated: (product: Product) => void;
}) {
  const next = useGetNextSkuQuery();
  const [createFromInvoice, { isLoading }] = useCreateProductFromInvoiceMutation();
  const categories = useGetCategoriesQuery().data;
  const [sku, setSku] = useState<string | null>(null);
  const [name, setName] = useState(line.description);
  const [brand, setBrand] = useState("");
  const [purchaseUnit, setPurchaseUnit] = useState(line.purchaseUnit ?? "");
  const [saleUnit, setSaleUnit] = useState("un");
  const [packageType, setPackageType] = useState("");
  const [unitsPerPackage, setUnitsPerPackage] = useState(line.unitsPerPack >= 2 ? String(line.unitsPerPack) : "");
  const [fractionable, setFractionable] = useState(false);
  const [ean, setEan] = useState(line.ean ?? "");
  const [problem, setProblem] = useState<{ message: string; code?: string; sku?: string } | null>(null);
  const [created, setCreated] = useState<Product | null>(null);
  // A classificação nasce do nome da linha (sugerida), a pessoa confirma ou troca, e uma escolha manual nunca é sobrescrita.
  const [classification, setClassification] = useState<ClassificationState>(EMPTY_CLASSIFICATION);
  const category = classification.category;
  const subcategory = classification.subcategory;
  useNameClassification(name, setClassification, created === null);

  const suggested = next.data?.suggested ?? null;
  const skuValue = sku ?? suggested ?? "";

  async function submit() {
    setProblem(null);
    if (!skuValue.trim() || !name.trim() || !category) return setProblem({ message: "Informe o código (SKU), o nome e a categoria do produto." });
    if (ean.trim() && !/^\d{8,14}$/.test(ean.trim())) return setProblem({ message: "O código de barras deve ter de 8 a 14 dígitos." });
    const perPackage = unitsPerPackage.trim() ? Number(unitsPerPackage) : undefined;
    if (perPackage !== undefined && (!Number.isInteger(perPackage) || perPackage < 1)) return setProblem({ message: "Unidades por embalagem: use um número inteiro." });

    try {
      const common = {
        sku: skuValue.trim(),
        name: name.trim(),
        category,
        subcategory: subcategory.trim() || undefined,
        classificationConfirmed: true,
        brand: brand.trim() || undefined,
        saleUnit: saleUnit.trim() || undefined,
        purchaseUnit: purchaseUnit.trim() || undefined,
        packageType: packageType.trim() || undefined,
        unitsPerPackage: perPackage,
        fractionable: perPackage ? fractionable : undefined,
        ean: ean.trim() || undefined,
      };
      const product = await createFromInvoice({ ...common, supplierId: invoice.supplierId, invoiceNumber: invoice.number, originOn: invoice.issuedOn }).unwrap();
      onCreated(product);
      toast.success(`Produto ${product.name} cadastrado.`);
      // Pela nota há custo: o preço sugerido vem em seguida.
      setCreated(product);
    } catch (failure) {
      const data = (failure as ApiError)?.data;
      setProblem({ message: data?.message ?? "Não foi possível cadastrar o produto.", code: data?.code, sku: data?.sku });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{created ? "Preço do produto novo" : "Cadastrar produto a partir da nota"}</DialogTitle>
          <DialogDescription>
            {created
              ? `${created.name} (SKU ${created.sku}) já está no cadastro. Escolha o preço.`
              : "O produto passa a existir no cadastro, com o código de barras da nota. Só falta o que a nota não traz."}
          </DialogDescription>
        </DialogHeader>

        {created ? (
          <NewProductPriceStep
            sku={created.sku}
            name={created.name}
            costCents={line.unitCostCents}
            costOrigin={`Nota fiscal ${invoice.number}`}
            costNotReceived={!invoice.received}
            onDone={() => onOpenChange(false)}
          />
        ) : (
          <>
            <div className="rounded-md border p-3 text-xs text-muted-foreground">
              <p>
                Cadastro originado de NF-e <strong>{invoice.number}</strong> · {formatDate(invoice.issuedOn)} · fornecedor {invoice.supplierName}
              </p>
              <p>
                Custo da nota: <strong>{formatCents(line.unitCostCents)}</strong> por unidade
                {invoice.received ? " — vale como custo do produto a partir do recebimento." : " — vale como custo do produto quando a compra for recebida."}
              </p>
            </div>

            <div className="grid gap-3">
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                Código (SKU)
                <Input value={skuValue} onChange={(e) => setSku(e.target.value)} aria-label="SKU do produto novo" inputMode="numeric" />
                {suggested !== null && sku === null && <span>Sugestão do sistema (o próximo depois do maior SKU de 6 dígitos): confirme ou troque. Um código que já existe é recusado.</span>}
                {next.isSuccess && suggested === null && <span>Não há SKU de 6 dígitos para contar a partir dele: digite o código.</span>}
              </label>
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                Nome
                <Input value={name} onChange={(e) => setName(e.target.value)} aria-label="Nome do produto novo" />
              </label>
              <CategoryFields categories={categories} state={classification} onChange={setClassification} categoryLabel="Categoria do produto novo" subcategoryLabel="Subcategoria do produto novo" />
              <div className="grid grid-cols-2 gap-3">
                <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                  Marca (opcional)
                  <Input value={brand} onChange={(e) => setBrand(e.target.value)} aria-label="Marca do produto novo" />
                </label>
                <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                  Unidade de compra (como o fornecedor vende)
                  <Input value={purchaseUnit} onChange={(e) => setPurchaseUnit(e.target.value)} aria-label="Unidade de compra do produto novo" placeholder="CX, FD, UN…" />
                </label>
                <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                  Unidade de venda
                  <Input value={saleUnit} onChange={(e) => setSaleUnit(e.target.value)} aria-label="Unidade de venda do produto novo" />
                </label>
                <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                  Código de barras (EAN)
                  <Input value={ean} onChange={(e) => setEan(e.target.value)} aria-label="Código de barras do produto novo" inputMode="numeric" />
                </label>
                <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                  Tipo de embalagem (opcional)
                  <Input value={packageType} onChange={(e) => setPackageType(e.target.value)} aria-label="Tipo de embalagem do produto novo" placeholder="caixa, fardo…" />
                </label>
                <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                  Fator: unidades por caixa/fardo
                  <Input value={unitsPerPackage} onChange={(e) => setUnitsPerPackage(e.target.value)} aria-label="Unidades por embalagem do produto novo" inputMode="numeric" />
                </label>
              </div>
              {unitsPerPackage.trim() && (
                <label className="flex items-center gap-1.5 text-sm">
                  <input type="checkbox" checked={fractionable} onChange={(e) => setFractionable(e.target.checked)} />
                  A embalagem pode ser fracionada no abastecimento
                </label>
              )}
            </div>

            {problem && (
              <div role="alert" className="rounded-md border border-destructive/50 p-3 text-sm text-destructive">
                <p>{problem.code === "ean_linked" && problem.sku ? `Este EAN já está vinculado ao produto ${problem.sku}.` : problem.message}</p>
                {problem.code === "ean_linked" && problem.sku && (
                  <p className="mt-1 text-xs">
                    Nenhum produto foi criado. Para não duplicar,{" "}
                    <a className="underline" href={`/products?sku=${encodeURIComponent(problem.sku)}`} target="_blank" rel="noreferrer">
                      Ver produto
                    </a>{" "}
                    ou{" "}
                    <a className="underline" href={`/products?sku=${encodeURIComponent(problem.sku)}&tab=overview`} target="_blank" rel="noreferrer">
                      Corrigir vínculo
                    </a>
                    . Se a nota usa o mesmo produto, escolha-o na linha em vez de cadastrar outro.
                  </p>
                )}
              </div>
            )}
          </>
        )}

        {!created && (
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isLoading}>
              Cancelar
            </Button>
            <Button onClick={submit} disabled={isLoading || !skuValue.trim()}>
              {isLoading ? "Cadastrando..." : "Cadastrar produto"}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
