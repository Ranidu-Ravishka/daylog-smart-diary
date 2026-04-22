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
import type * as admin_services_adminAuditLogsService from "../admin/services/adminAuditLogsService.js";
import type * as admin_services_adminAuditService from "../admin/services/adminAuditService.js";
import type * as admin_services_adminDaysQueryService from "../admin/services/adminDaysQueryService.js";
import type * as admin_services_adminIntegrationsQueryService from "../admin/services/adminIntegrationsQueryService.js";
import type * as admin_services_adminIntegrationsService from "../admin/services/adminIntegrationsService.js";
import type * as admin_services_adminMemoriesQueryService from "../admin/services/adminMemoriesQueryService.js";
import type * as admin_services_adminPreferencesService from "../admin/services/adminPreferencesService.js";
import type * as admin_services_adminSummariesQueryService from "../admin/services/adminSummariesQueryService.js";
import type * as admin_services_auditLogsService from "../admin/services/auditLogsService.js";
import type * as admin_utilities_adminRecordMappers from "../admin/utilities/adminRecordMappers.js";
import type * as admin_utilities_adminUserPatch from "../admin/utilities/adminUserPatch.js";
import type * as authz from "../authz.js";
import type * as cascadeCleanup from "../cascadeCleanup.js";
import type * as content from "../content.js";
import type * as crons from "../crons.js";
import type * as dashboardMetrics from "../dashboardMetrics.js";
import type * as days from "../days.js";
import type * as env from "../env.js";
import type * as featureFlags from "../featureFlags.js";
import type * as http from "../http.js";
import type * as integrationHealth from "../integrationHealth.js";
import type * as integrationPlugins from "../integrationPlugins.js";
import type * as integrationProviders from "../integrationProviders.js";
import type * as integrationSecretsCrypto from "../integrationSecretsCrypto.js";
import type * as integrations from "../integrations.js";
import type * as integrations_utilities_integrationLimits from "../integrations/utilities/integrationLimits.js";
import type * as memories from "../memories.js";
import type * as observability from "../observability.js";
import type * as observabilityIngestRateLimiter from "../observabilityIngestRateLimiter.js";
import type * as observabilityIngestion from "../observabilityIngestion.js";
import type * as observabilityIngestionSecurity from "../observabilityIngestionSecurity.js";
import type * as personalInsights from "../personalInsights.js";
import type * as planLimits from "../planLimits.js";
import type * as providerAdapters from "../providerAdapters.js";
import type * as retention from "../retention.js";
import type * as runtimeConfig from "../runtimeConfig.js";
import type * as sensitiveDataCrypto from "../sensitiveDataCrypto.js";
import type * as sensitiveDataFields from "../sensitiveDataFields.js";
import type * as sensitiveDataMigration from "../sensitiveDataMigration.js";
import type * as summaries from "../summaries.js";
import type * as summaries_services_summaryCoreService from "../summaries/services/summaryCoreService.js";
import type * as summaries_utilities_exportSigning from "../summaries/utilities/exportSigning.js";
import type * as summaries_utilities_restoreExportUtils from "../summaries/utilities/restoreExportUtils.js";
import type * as summaryGeneration from "../summaryGeneration.js";
import type * as summaryQuality from "../summaryQuality.js";
import type * as unsupportedProviders from "../unsupportedProviders.js";
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
  "admin/services/adminAuditLogsService": typeof admin_services_adminAuditLogsService;
  "admin/services/adminAuditService": typeof admin_services_adminAuditService;
  "admin/services/adminDaysQueryService": typeof admin_services_adminDaysQueryService;
  "admin/services/adminIntegrationsQueryService": typeof admin_services_adminIntegrationsQueryService;
  "admin/services/adminIntegrationsService": typeof admin_services_adminIntegrationsService;
  "admin/services/adminMemoriesQueryService": typeof admin_services_adminMemoriesQueryService;
  "admin/services/adminPreferencesService": typeof admin_services_adminPreferencesService;
  "admin/services/adminSummariesQueryService": typeof admin_services_adminSummariesQueryService;
  "admin/services/auditLogsService": typeof admin_services_auditLogsService;
  "admin/utilities/adminRecordMappers": typeof admin_utilities_adminRecordMappers;
  "admin/utilities/adminUserPatch": typeof admin_utilities_adminUserPatch;
  authz: typeof authz;
  cascadeCleanup: typeof cascadeCleanup;
  content: typeof content;
  crons: typeof crons;
  dashboardMetrics: typeof dashboardMetrics;
  days: typeof days;
  env: typeof env;
  featureFlags: typeof featureFlags;
  http: typeof http;
  integrationHealth: typeof integrationHealth;
  integrationPlugins: typeof integrationPlugins;
  integrationProviders: typeof integrationProviders;
  integrationSecretsCrypto: typeof integrationSecretsCrypto;
  integrations: typeof integrations;
  "integrations/utilities/integrationLimits": typeof integrations_utilities_integrationLimits;
  memories: typeof memories;
  observability: typeof observability;
  observabilityIngestRateLimiter: typeof observabilityIngestRateLimiter;
  observabilityIngestion: typeof observabilityIngestion;
  observabilityIngestionSecurity: typeof observabilityIngestionSecurity;
  personalInsights: typeof personalInsights;
  planLimits: typeof planLimits;
  providerAdapters: typeof providerAdapters;
  retention: typeof retention;
  runtimeConfig: typeof runtimeConfig;
  sensitiveDataCrypto: typeof sensitiveDataCrypto;
  sensitiveDataFields: typeof sensitiveDataFields;
  sensitiveDataMigration: typeof sensitiveDataMigration;
  summaries: typeof summaries;
  "summaries/services/summaryCoreService": typeof summaries_services_summaryCoreService;
  "summaries/utilities/exportSigning": typeof summaries_utilities_exportSigning;
  "summaries/utilities/restoreExportUtils": typeof summaries_utilities_restoreExportUtils;
  summaryGeneration: typeof summaryGeneration;
  summaryQuality: typeof summaryQuality;
  unsupportedProviders: typeof unsupportedProviders;
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
