import { useEffect, useRef, useState } from "react";
import { socket } from "../services/socket";

/**
 * Subscribes to live ticks for exactly the given symbols (diffing
 * subscribe/unsubscribe as the list changes) and returns a
 * { [symbol]: tick } map that updates as ticks arrive. Callers should pass
 * only symbols actually in view -- see Dashboard's virtualized row range --
 * not the full company list, since the backend fans out per-symbol Kite
 * subscriptions on demand.
 */
export function useLiveQuotes(symbols) {
  const [quotes, setQuotes] = useState({});
  const subscribedRef = useRef(new Set());
  const key = symbols.join(",");

  useEffect(() => {
    const nextSet = new Set(symbols);
    const previousSet = subscribedRef.current;

    for (const symbol of nextSet) {
      if (!previousSet.has(symbol)) {
        socket.emit("subscribe", symbol);
      }
    }

    for (const symbol of previousSet) {
      if (!nextSet.has(symbol)) {
        socket.emit("unsubscribe", symbol);
      }
    }

    subscribedRef.current = nextSet;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    const handleTick = (tick) => {
      setQuotes((prev) => ({ ...prev, [tick.symbol]: tick }));
    };

    socket.on("tick", handleTick);
    return () => socket.off("tick", handleTick);
  }, []);

  useEffect(() => {
    return () => {
      for (const symbol of subscribedRef.current) {
        socket.emit("unsubscribe", symbol);
      }
      subscribedRef.current = new Set();
    };
  }, []);

  return quotes;
}
