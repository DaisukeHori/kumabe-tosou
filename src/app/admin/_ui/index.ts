export { Surface, DataTableShell } from "./surface";
export { PageHeader } from "./page-header";
export { DataTableHeaderRow, dataTableRowClassName } from "./data-table";
export { ContentStatusBadge } from "./status-badge";
export { MediaPicker, type PickerMediaItem } from "./media-picker";
export { ColorPicker, DEFAULT_COLOR_PRESETS, type ColorPreset } from "./color-picker";
// 公開サイトとは独立した admin scope から、既存 shadcn Card もこの barrel 経由で
// 使えるようにしておく (ダッシュボード等、既にカードがある画面の統一窓口)。
export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardAction,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
