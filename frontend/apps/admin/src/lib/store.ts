import { configureStore } from "@reduxjs/toolkit";

import { authApi } from "@/lib/api/auth";
import { ingestionApi } from "@/lib/api/ingestion";
import { financeApi } from "@/lib/api/finance";
import { inventoryApi } from "@/lib/api/inventory";
import { overviewApi } from "@/lib/api/overview";
import { productsApi } from "@/lib/api/products";
import { salesApi } from "@/lib/api/sales";
import { storesApi } from "@/lib/api/stores";
import { supplyApi } from "@/lib/api/supply";

export function makeStore() {
  return configureStore({
    reducer: {
      [authApi.reducerPath]: authApi.reducer,
      [storesApi.reducerPath]: storesApi.reducer,
      [productsApi.reducerPath]: productsApi.reducer,
      [inventoryApi.reducerPath]: inventoryApi.reducer,
      [salesApi.reducerPath]: salesApi.reducer,
      [financeApi.reducerPath]: financeApi.reducer,
      [supplyApi.reducerPath]: supplyApi.reducer,
      [overviewApi.reducerPath]: overviewApi.reducer,
      [ingestionApi.reducerPath]: ingestionApi.reducer,
    },
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware().concat(
        authApi.middleware,
        storesApi.middleware,
        productsApi.middleware,
        inventoryApi.middleware,
        salesApi.middleware,
        financeApi.middleware,
        supplyApi.middleware,
        overviewApi.middleware,
        ingestionApi.middleware,
      ),
  });
}

export type AppStore = ReturnType<typeof makeStore>;
export type RootState = ReturnType<AppStore["getState"]>;
export type AppDispatch = AppStore["dispatch"];
