// Design-system barrel: components + kit + shell + marks + icon.
export { Icon } from "./icon";
export { Badge, Callout, ProgressBar, StatusPill, Tooltip } from "./components/feedback";
export { StateBlock } from "./components/state";
export { Button, IconButton, Input, Select, Checkbox, Radio, Switch, MultiSelect } from "./components/forms";
export { Card } from "./components/surfaces";
export { Tabs } from "./components/ui";
export { useToast, Toast, Modal, Field, HnTextarea, serverPage, Pager, LIST_SCROLL_STYLE, LIST_SCREEN_STYLE, FIXED_ROW_STYLE } from "./kit";
export type { ToastData, ShowToast } from "./kit";
export { ConfirmDialog } from "./ConfirmDialog";
export { Shell, HN_NAV, NAV_KEYS } from "./shell";
export { MarkdownView, hnDocHtml, isMarkdownPath } from "./markdown";
export { DocDownload } from "./DocDownload";
export { DocPreviewModal } from "./DocPreviewModal";
export { Mark, Wordmark, HN_MARKS } from "./marks";
export {
  Illustration,
  MascotIllustration,
  ProductStateIllustration,
  SpotIllustration,
  StickerIllustration,
} from "./Illustration";
export type {
  IllustrationProps,
  MascotIllustrationProps,
  ProductStateIllustrationProps,
  SpotIllustrationProps,
  StickerIllustrationProps,
} from "./Illustration";
export { ILLUSTRATIONS, ILLUSTRATION_IDS, illustrationsByFamily } from "./illustration-registry";
export type {
  IllustrationAsset,
  IllustrationFamily,
  IllustrationId,
  IllustrationRatio,
  MascotIllustrationId,
  ProductStateIllustrationId,
  SpotIllustrationId,
  StickerIllustrationId,
} from "./illustration-registry";
