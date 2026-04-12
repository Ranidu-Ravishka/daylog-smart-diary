import { httpRouter } from "convex/server";
import { clerkWebhook } from "./webhooks";
import {
  ingestObservabilityInfoEvent,
  observabilityInfoEventOptions,
} from "./observabilityIngestion";
import "./env";

const http = httpRouter();

http.route({
  path: "/clerk/webhook",
  method: "POST",
  handler: clerkWebhook,
});

http.route({
  path: "/observability/info-event",
  method: "OPTIONS",
  handler: observabilityInfoEventOptions,
});

http.route({
  path: "/observability/info-event",
  method: "POST",
  handler: ingestObservabilityInfoEvent,
});

export default http;
