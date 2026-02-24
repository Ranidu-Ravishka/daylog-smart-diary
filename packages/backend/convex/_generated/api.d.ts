/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as admin from "../admin.js";
import type * as authz from "../authz.js";
import type * as content from "../content.js";
import type * as days from "../days.js";
import type * as http from "../http.js";
import type * as integrations from "../integrations.js";
import type * as memories from "../memories.js";
import type * as myFunctions from "../myFunctions.js";
import type * as summaries from "../summaries.js";
import type * as userPreferences from "../userPreferences.js";
import type * as users from "../users.js";
import type * as validators from "../validators.js";
import type * as webhooks from "../webhooks.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  admin: typeof admin;
  authz: typeof authz;
  content: typeof content;
  days: typeof days;
  http: typeof http;
  integrations: typeof integrations;
  memories: typeof memories;
  myFunctions: typeof myFunctions;
  summaries: typeof summaries;
  userPreferences: typeof userPreferences;
  users: typeof users;
  validators: typeof validators;
  webhooks: typeof webhooks;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
