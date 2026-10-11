import { useEffect, useSyncExternalStore } from "react";
import { subscribe } from "./events";
import { installModelCatalog, modelCatalogSnapshot, subscribeModelCatalog } from "./model-catalog-state";

let users = 0;
/**
 * `enabled = false` (klien, atau login belum diketahui) tak memanggil `/api/models` dan tak membuka
 * socket. Katalog yang sudah terpasang atau bundel tetap dikembalikan apa adanya.
 */
export function useModelCatalog(enabled = true) {
  const catalog = useSyncExternalStore(subscribeModelCatalog, modelCatalogSnapshot, modelCatalogSnapshot);
  useEffect(() => {
    if (!enabled) return undefined;
    const disconnect = subscribe(() => {});
    if (users++ === 0) {
      const before = modelCatalogSnapshot();
      void Promise.resolve().then(() => fetch("/api/models", { credentials: "same-origin" }))
        .then(async (response) => {
          if (response.ok && modelCatalogSnapshot() === before) {
            const next = await response.json();
            if (modelCatalogSnapshot() === before) installModelCatalog(next);
          }
        }).catch(() => { /* Bundled/last-good remains usable while HTTP or WS reconnects. */ });
    }
    return () => { users--; disconnect(); };
  }, [enabled]);
  return catalog;
}
