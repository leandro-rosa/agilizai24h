"use client";

import { useMemo, useState } from "react";

import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useGetStoresQuery } from "@/lib/api/stores";
import type { Store } from "@/mocks/stores";

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
  const { data: stores, isLoading } = useGetStoresQuery();
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

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>Endereço</TableHead>
              <TableHead>Cidade</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 5 }).map((__, j) => (
                    <TableCell key={j}>
                      <Skeleton className="h-4 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground">
                  Nenhuma loja encontrada.
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((store) => (
                <TableRow key={store.id}>
                  <TableCell className="font-medium">{store.name}</TableCell>
                  <TableCell className="text-muted-foreground">{store.address}</TableCell>
                  <TableCell>{store.city}</TableCell>
                  <TableCell>{typeLabel[store.type]}</TableCell>
                  <TableCell>
                    <Badge className={statusVariant[store.status].className}>
                      {statusVariant[store.status].label}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
