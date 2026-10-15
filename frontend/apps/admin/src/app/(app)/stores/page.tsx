"use client";

import { useMemo, useState } from "react";

import { PageHeader } from "@/components/page-header";
import { RequestState } from "@/components/request-state";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { count, date } from "@/lib/format";
import { useGetStoresQuery, type Store } from "@/lib/api/stores";

const statusVariant: Record<Store["status"], { label: string; className: string }> = {
  active: { label: "Ativa", className: "bg-secondary text-secondary-foreground" },
  maintenance: { label: "Manutenção", className: "bg-warning/15 text-warning border border-warning/30" },
  inactive: { label: "Inativa", className: "bg-destructive/10 text-destructive" },
};

const typeLabel: Record<Store["type"], string> = {
  company: "Empresa",
  condo: "Condomínio",
};

export default function StoresPage() {
  const { data: stores, isLoading, error, refetch } = useGetStoresQuery();
  const [search, setSearch] = useState("");
  const [type, setType] = useState<string>("all");

  const filtered = useMemo(() => {
    return (stores ?? []).filter((store) => {
      const matchSearch = store.name.toLowerCase().includes(search.toLowerCase()) ||
        store.city.toLowerCase().includes(search.toLowerCase());
      const matchType = type === "all" || store.type === type;
      return matchSearch && matchType;
    });
  }, [stores, search, type]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Lojas" description="Unidades instaladas em empresas e condomínios." />

      <div className="flex flex-col gap-3 sm:flex-row">
        <Input
          placeholder="Buscar por nome ou cidade..."
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="sm:max-w-xs"
        />
        <Select value={type} onValueChange={setType}>
          <SelectTrigger className="sm:w-48">
            <SelectValue placeholder="Tipo" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os tipos</SelectItem>
            <SelectItem value="company">Empresa</SelectItem>
            <SelectItem value="condo">Condomínio</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <RequestState
        isLoading={isLoading}
        error={error}
        isEmpty={filtered.length === 0}
        emptyMessage="Nenhuma loja encontrada."
        onRetry={refetch}
        loadingRows={6}
      >
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Código do site</TableHead>
                <TableHead>CNPJ</TableHead>
                <TableHead>Cidade</TableHead>
                <TableHead className="tabular text-right">Pessoas</TableHead>
                <TableHead>Inauguração</TableHead>
                <TableHead>Voltagem</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((store) => (
                <TableRow key={store.id}>
                  <TableCell className="font-medium">
                    {store.name}
                    <span className="block text-xs text-muted-foreground">{store.address}</span>
                  </TableCell>
                  {/* Código do SITE do cliente, não o do PDV — são
                      identificadores de sistemas diferentes e divergem. */}
                  <TableCell className="tabular text-xs">{store.client_code ?? "—"}</TableCell>
                  <TableCell className="tabular text-xs">{store.tax_id ?? "—"}</TableCell>
                  <TableCell>{store.city}</TableCell>
                  <TableCell className="tabular text-right">{count(store.headcount)}</TableCell>
                  <TableCell className="tabular">{date(store.opened_on)}</TableCell>
                  <TableCell className="text-xs">{store.voltage ?? "—"}</TableCell>
                  <TableCell>{typeLabel[store.type]}</TableCell>
                  <TableCell>
                    <Badge className={statusVariant[store.status].className}>
                      {statusVariant[store.status].label}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </RequestState>
    </div>
  );
}
