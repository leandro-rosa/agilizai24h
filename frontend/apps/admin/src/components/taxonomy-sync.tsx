"use client";

import { useEffect } from "react";

import { useGetCategoriesQuery } from "@/lib/api/products";
import { registerCategoryNames } from "@/lib/products/taxonomy";

/** Mantém os nomes de categoria do cadastro à mão do código que não tem hook (os textos das análises de vendas). Não desenha nada. */
export function TaxonomySync() {
  const { data } = useGetCategoriesQuery();
  useEffect(() => registerCategoryNames(data), [data]);

  return null;
}
