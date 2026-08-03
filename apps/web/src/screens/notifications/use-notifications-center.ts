/*
 * Data hooks for the Notifications Center screen (route `notifications`).
 *
 * Every read/write goes through the generated typed client (api-client.ts) + TanStack
 * Query via unwrap() — no hand-written models/fetch (PLAN.md §5, apps/web/CLAUDE.md).
 * The prototype held all notifications in a local `NOTIFS` array (extra-screens.jsx
 * L159-170); here the server is the system of record:
 *   GET  /notifications          -> the session user's notifications (listNotifications;
 *                                   B-014 paginated `.data`). REUSED from the shell bell
 *                                   (use-shell-data useNotifications) so the center screen
 *                                   and the bell dot share one cache entry (["notifications"]).
 *   POST /notifications/{id}/read -> mark one read (readNotification → ActionOk, 404). The
 *                                   center's row click + the "mark all read" action both
 *                                   drive this; there is no bulk endpoint, so "mark all"
 *                                   fans the per-id POST over the unread ids. Both mutations
 *                                   invalidate ["notifications"] so the list AND the bell
 *                                   dot refresh.
 */
import { useMutation, useQueryClient, type UseMutationResult } from "@tanstack/react-query";
import { apiClient } from "../../api-client";
import { unwrap } from "../../query-client";

/** The shared notifications cache key (also owned by the shell bell popover). */
const NOTIF_KEY = ["notifications"] as const;

// Re-export the shell's list read so the screen imports its data from one place.
export { useNotifications } from "../../shell/use-shell-data";

/** POST one notification's /read action, then refresh the list + bell dot. */
export function useMarkNotificationRead(): UseMutationResult<unknown, unknown, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      unwrap(apiClient.POST("/notifications/{id}/read", { params: { path: { id } } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: NOTIF_KEY }),
  });
}

/**
 * "Mark all read" — fan the per-id /read POST over the given unread ids (no bulk endpoint
 * in the contract). Resolves once every row is marked, then invalidates once.
 */
export function useMarkAllNotificationsRead(): UseMutationResult<unknown, unknown, string[]> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) =>
      Promise.all(
        ids.map((id) =>
          unwrap(apiClient.POST("/notifications/{id}/read", { params: { path: { id } } })),
        ),
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: NOTIF_KEY }),
  });
}
