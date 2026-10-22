"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { CircleCheck, Info, TriangleAlert, X, XCircle } from "lucide-react";

import { IconButton } from "@/components/ui/Controls";
import {
  autoDismissMs,
  dismissToast,
  pushToast,
  type ToastItem,
  type ToastKind,
} from "@/lib/client/toastQueue";

type ToastInput = Omit<ToastItem, "id">;
type ToastApi = { toast: (input: ToastInput) => void };

const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error("useToast must be used inside <ToastProvider>");
  return api;
}

const KIND_STYLES: Record<ToastKind, { bar: string; icon: ReactNode }> = {
  info: {
    bar: "border-l-ink",
    icon: <Info aria-hidden className="h-4 w-4 text-ink" />,
  },
  success: {
    bar: "border-l-ledger",
    icon: <CircleCheck aria-hidden className="h-4 w-4 text-ledger" />,
  },
  warning: {
    bar: "border-l-marker",
    icon: <TriangleAlert aria-hidden className="h-4 w-4 text-marker" />,
  },
  error: {
    bar: "border-l-stamp",
    icon: <XCircle aria-hidden className="h-4 w-4 text-stamp" />,
  },
};

function ToastCard({
  item,
  onDismiss,
}: {
  item: ToastItem;
  onDismiss: () => void;
}) {
  const loud = item.kind === "error" || item.kind === "warning";
  return (
    <div
      role={loud ? "alert" : "status"}
      aria-live={loud ? "assertive" : "polite"}
      className={`pointer-events-auto flex items-start gap-2.5 rounded-lg border border-rule border-l-4 bg-paper p-3 shadow-lg ${KIND_STYLES[item.kind].bar}`}
    >
      <span className="mt-0.5 shrink-0">{KIND_STYLES[item.kind].icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium text-ink">{item.title}</p>
        {item.detail ? (
          <p className="mt-0.5 text-[12px] leading-relaxed text-ink-soft">
            {item.detail}
          </p>
        ) : null}
      </div>
      <IconButton label="Dismiss" onClick={onDismiss} className="-mr-1 -mt-1">
        <X aria-hidden className="h-3.5 w-3.5" />
      </IconButton>
    </div>
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
    setItems((list) => dismissToast(list, id));
  }, []);

  const toast = useCallback(
    (input: ToastInput) => {
      const id = nextId.current++;
      setItems((list) => pushToast(list, input, id));
      const ms = autoDismissMs(input.kind);
      if (ms !== null) {
        timers.current.set(
          id,
          setTimeout(() => dismiss(id), ms),
        );
      }
    },
    [dismiss],
  );

  useEffect(
    () => () => {
      for (const timer of timers.current.values()) clearTimeout(timer);
    },
    [],
  );

  const api = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2">
        {items.map((item) => (
          <ToastCard
            key={item.id}
            item={item}
            onDismiss={() => dismiss(item.id)}
          />
        ))}
      </div>
    </ToastContext.Provider>
  );
}
