import React from "react";

import { useMutation } from "convex/react";

import { api } from "@repo/backend/convex";
import {
  createBackgroundTaskRunner,
  type BackgroundTaskExecutionEvent,
} from "@/lib/background-task-runner";
import {
  processOfflineOutbox,
  type AppendDayLogOutboxPayload,
  type CreateMemoryOutboxPayload,
  type UploadMemoryMediaOutboxPayload,
} from "@/lib/offline-outbox";
import { captureException, logInfo } from "@/lib/observability";
import { toErrorMessage } from "@/hooks/tab-orchestration/utils";

type ConnectivityState = {
  isConnected: boolean | null;
  isInternetReachable: boolean | null;
};

type UseOfflineQueueParams = {
  isAuthenticated: boolean;
};

async function subscribeToConnectivityChanges(
  onOnline: () => void,
): Promise<() => void> {
  try {
    const netInfoModule = await import("@react-native-community/netinfo");
    const addEventListener =
      netInfoModule.addEventListener ?? netInfoModule.default?.addEventListener;

    if (typeof addEventListener !== "function") {
      logInfo("mobile_netinfo_listener_unavailable", {
        reason: "addEventListener_missing",
      });
      return () => {};
    }

    const unsubscribe = addEventListener((state: ConnectivityState) => {
      const isConnected = Boolean(state.isConnected);
      const isInternetReachable = state.isInternetReachable !== false;

      if (isConnected && isInternetReachable) {
        onOnline();
      }
    });

    if (typeof unsubscribe === "function") {
      return unsubscribe;
    }

    return () => {};
  } catch (error) {
    logInfo("mobile_netinfo_listener_unavailable", {
      reason: toErrorMessage(error),
    });
    return () => {};
  }
}

export function useOfflineQueue({
  isAuthenticated,
}: UseOfflineQueueParams): void {
  const createMemoryFromOutbox = useMutation(api.memories.createMemory);
  const createMemoryMediaUploadUrlFromOutbox = useMutation(
    api.memories.generateMemoryMediaUploadUrl,
  );
  const addMemoryMediaByClientRequestIdFromOutbox = useMutation(
    api.memories.addMemoryMediaByClientRequestId,
  );
  const appendDayLogEntriesFromOutbox = useMutation(
    api.days.appendDayLogEntries,
  );

  React.useEffect(() => {
    if (!isAuthenticated) {
      return;
    }

    let cancelled = false;

    const flushOutbox = async () => {
      if (cancelled) {
        return;
      }

      const uploadMemoryMedia = async (
        payload: UploadMemoryMediaOutboxPayload,
      ) => {
        const localMediaResponse = await fetch(payload.localUri);
        if (!localMediaResponse.ok) {
          throw new Error(
            `Staged media file could not be read (status ${localMediaResponse.status}).`,
          );
        }

        const mediaBlob = await localMediaResponse.blob();
        const { uploadUrl } = await createMemoryMediaUploadUrlFromOutbox({});

        const uploadResponse = await fetch(uploadUrl, {
          method: "POST",
          headers: {
            "Content-Type": mediaBlob.type || "application/octet-stream",
          },
          body: mediaBlob,
        });

        if (!uploadResponse.ok) {
          throw new Error(`Upload failed with status ${uploadResponse.status}`);
        }

        const uploadResult = (await uploadResponse.json()) as {
          storageId?: string;
        };
        if (!uploadResult.storageId) {
          throw new Error("Upload succeeded but no storageId was returned.");
        }

        await addMemoryMediaByClientRequestIdFromOutbox({
          memoryClientRequestId: payload.memoryClientRequestId,
          clientMediaId: payload.mediaClientRequestId,
          storageId: uploadResult.storageId,
          type: "image",
          width: payload.width,
          height: payload.height,
        });
      };

      const result = await processOfflineOutbox({
        createMemory: async (payload: CreateMemoryOutboxPayload) => {
          await createMemoryFromOutbox(payload);
        },
        appendDayLog: async (payload: AppendDayLogOutboxPayload) => {
          await appendDayLogEntriesFromOutbox(payload);
        },
        uploadMemoryMedia,
      });

      if (
        result.processed > 0 ||
        result.retried > 0 ||
        result.dropped > 0 ||
        result.pending > 0
      ) {
        logInfo("mobile_offline_outbox_flush_result", result);
      }
    };

    const runner = createBackgroundTaskRunner({
      tickIntervalMs: 1_000,
      onExecution: (event: BackgroundTaskExecutionEvent) => {
        if (event.taskId !== "offline_outbox_flush") {
          return;
        }

        logInfo("mobile_offline_outbox_task_execution", {
          taskId: event.taskId,
          status: event.status,
          attempt: event.attempt,
          queueDepth: event.queueDepth,
          durationMs: event.durationMs,
          error: event.error,
          nextRunAt: event.nextRunAt,
        });
      },
    });

    runner.registerTask({
      taskId: "offline_outbox_flush",
      intervalMs: 20_000,
      run: flushOutbox,
      retryPolicy: {
        maxAttempts: 3,
        baseDelayMs: 10_000,
        maxDelayMs: 2 * 60 * 1_000,
      },
    });

    runner.start();
    runner.triggerTaskNow("offline_outbox_flush");

    logInfo("mobile_offline_queue_module_started", {
      taskId: "offline_outbox_flush",
    });

    let unsubscribeNetInfo = () => {};

    void (async () => {
      try {
        const unsubscribe = await subscribeToConnectivityChanges(() => {
          runner.triggerTaskNow("offline_outbox_flush");
        });

        if (cancelled) {
          unsubscribe();
          return;
        }

        unsubscribeNetInfo = unsubscribe;
      } catch (error) {
        if (cancelled) {
          return;
        }

        captureException(
          "mobile_offline_queue_connectivity_setup_failed",
          error,
        );
      }
    })();

    return () => {
      cancelled = true;
      unsubscribeNetInfo();
      runner.stop();
      logInfo("mobile_offline_queue_module_stopped", {
        taskId: "offline_outbox_flush",
      });
    };
  }, [
    addMemoryMediaByClientRequestIdFromOutbox,
    appendDayLogEntriesFromOutbox,
    createMemoryFromOutbox,
    createMemoryMediaUploadUrlFromOutbox,
    isAuthenticated,
  ]);
}
