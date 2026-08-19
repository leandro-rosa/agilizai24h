import { createApi } from "@reduxjs/toolkit/query/react";

import { gatewayBaseQuery } from "./base-query";

/** Mirrors `gateway-service`'s `AuthenticatedCaller` — identity plus effective permissions, resolved fresh on every request. */
export interface AuthenticatedCaller {
  id: number;
  email: string;
  name: string;
  roles: string[];
  permissions: string[];
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  user: AuthenticatedCaller;
  expires_at: string;
}

export const authApi = createApi({
  reducerPath: "authApi",
  baseQuery: gatewayBaseQuery,
  tagTypes: ["Session"],
  endpoints: (builder) => ({
    /**
     * The route guard's own source of truth: a session lives in an
     * HTTP-only cookie the panel cannot read, so this is the only way to
     * know whether one exists — and, once it does, what the operator is
     * allowed to do.
     */
    getMe: builder.query<AuthenticatedCaller, void>({
      query: () => "/auth/me",
      providesTags: ["Session"],
    }),
    login: builder.mutation<LoginResponse, LoginRequest>({
      query: (body) => ({ url: "/auth/login", method: "POST", body }),
      invalidatesTags: ["Session"],
    }),
    logout: builder.mutation<void, void>({
      query: () => ({ url: "/auth/logout", method: "POST" }),
      invalidatesTags: ["Session"],
    }),
  }),
});

export const { useGetMeQuery, useLoginMutation, useLogoutMutation } = authApi;
