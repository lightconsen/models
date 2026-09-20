import { useCallback, useState } from "react";

const LS_KEY = "kiwano.dismissedNews";

/** Which news items this viewer has dismissed, remembered across reloads.
    Shared by the homepage strip and the per-provider notices so one dismissal
    hides the item everywhere. */
export function useDismissedNews() {
  const [dismissed, setDismissed] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem(LS_KEY) ?? "[]") as string[]);
    } catch {
      return new Set();
    }
  });

  const dismiss = useCallback((id: string) => {
    setDismissed((prev) => {
      const next = new Set(prev);
      next.add(id);
      try {
        localStorage.setItem(LS_KEY, JSON.stringify([...next]));
      } catch {
        /* storage may be unavailable (private mode); the set still works for this tab */
      }
      return next;
    });
  }, []);

  return { isDismissed: (id: string) => dismissed.has(id), dismiss };
}