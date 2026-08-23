// State tampilan persisten per layar (SPEC-740 · ADR-0115).
export {
  UI_PREFIX, UI_VERSION, scoped, uiKey, uiScreenPrefix,
  readUiState, writeUiState, resetUiState, pruneUiState, onUiReset,
  isStr, isNum, isBool, nullableStr, strList, oneOf,
} from "./store";
export type { Accept } from "./store";
export { usePersistedState, useScrollRestore, useResetOnChange } from "./hooks";
export { ResetViewButton } from "./ResetViewButton";
