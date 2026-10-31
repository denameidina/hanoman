// Design-system barrel: components + kit + shell + marks + icon.
export { Icon } from "./icon";
export { Badge, Callout, ProgressBar, StatusPill, Tooltip } from "./components/feedback";
export { StateBlock } from "./components/state";
export { LiveConnectionBadge } from "./components/live";
export { Button, IconButton, Input, Select, Checkbox, Radio, RadioGroup, Switch, MultiSelect } from "./components/forms";
export { Card } from "./components/surfaces";
export { Tabs, TabPanel, OverflowActions, useScrollEdges } from "./components/ui";
export type { OverflowItem } from "./components/ui";
export { PageHeader, FilterBar, RowList, DenseRow, Stack, Inline, Text } from "./components/layout";
export type { FilterChip, SpaceStep, TextSize, TextTone } from "./components/layout";
export { Skeleton, SkeletonList } from "./components/skeleton";
export { useToast, Toast, ToastHost, TOAST_VISIBLE, Modal, Field, HnTextarea, serverPage, Pager, LIST_SCROLL_STYLE, LIST_SCREEN_STYLE, FIXED_ROW_STYLE } from "./kit";
export type { ToastData, ShowToast, ToastQueue, ToastOptions, ToastAction } from "./kit";
export { ConfirmDialog } from "./ConfirmDialog";
export { useConfirm, type ConfirmOptions } from "./useConfirm";
export { Shell, HN_NAV, NAV_KEYS, NavGate, NavPending } from "./shell";
export {
  DESKTOP_QUERY,
  LocalOverflow,
  MOBILE_MAX,
  MOBILE_QUERY,
  ResponsivePanels,
  ResponsiveToolbar,
  TABLET_MAX,
  TABLET_QUERY,
  responsiveTier,
  useCoarsePointer,
  useResponsiveTier,
} from "./responsive";
export { usePopoverFocus } from "./popover";
export type { ResponsivePanel, ResponsiveTier } from "./responsive";
export { MarkdownView, hnDocHtml, isMarkdownPath } from "./markdown";
export { ImageViewer, type ViewerImage } from "./ImageViewer";
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
