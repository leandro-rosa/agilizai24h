import { configureStore } from "@reduxjs/toolkit";

import { financeApi } from "@/lib/api/finance";
import { inventoryApi } from "@/lib/api/inventory";
import { productsApi } from "@/lib/api/products";
import { salesApi } from "@/lib/api/sales";
import { storesApi } from "@/lib/api/stores";
import { supplyApi } from "@/lib/api/supply";

export function makeStore() {
  return configureStore({
    reducer: {
      [storesApi.reducerPath]: storesApi.reducer,
      [productsApi.reducerPath]: productsApi.reducer,
      [inventoryApi.reducerPath]: inventoryApi.reducer,
      [salesApi.reducerPath]: salesApi.reducer,
      [financeApi.reducerPath]: financeApi.reducer,
      [supplyApi.reducerPath]: supplyApi.reducer,
    },
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware().concat(
        storesApi.middleware,
        productsApi.middleware,
        inventoryApi.middleware,
        salesApi.middleware,
        financeApi.middleware,
        supplyApi.middleware,
      ),
  });
}

export type AppStore = ReturnType<typeof makeStore>;
export type RootState = ReturnType<AppStore["getState"]>;
export type AppDispatch = AppStore["dispatch"];
