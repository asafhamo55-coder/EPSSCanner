// Tokens
export { tokens } from './tokens'
export type { HubKey } from './tokens'

// Utilities
export { cn } from './lib/cn'

// Primitives
export { Button, buttonVariants } from './components/Button'
export type { ButtonProps } from './components/Button'

export { Badge, badgeVariants } from './components/Badge'
export type { BadgeProps } from './components/Badge'

export { StatusBadge, humanizeStatus } from './components/StatusBadge'
export type { StatusBadgeProps } from './components/StatusBadge'

export { Input } from './components/Input'
export type { InputProps } from './components/Input'

export { Textarea } from './components/Textarea'
export type { TextareaProps } from './components/Textarea'

export { Skeleton } from './components/Skeleton'
export { Separator } from './components/Separator'

export {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from './components/Card'
export type { CardProps } from './components/Card'

export { StatCard } from './components/StatCard'
export type { StatCardProps } from './components/StatCard'

// Feedback
export { Alert } from './components/Alert'
export type { AlertProps } from './components/Alert'

export { EmptyState } from './components/EmptyState'
export type { EmptyStateProps } from './components/EmptyState'

// AI-specific (mandatory gate before any AI artifact ships)
export { BarBGate } from './components/BarBGate'
export type { BarBGateProps } from './components/BarBGate'

// Layout
export {
  AppShell,
  AppShellSidebar,
  AppShellMain,
  AppShellHeader,
  AppShellContent,
} from './layouts/AppShell'

// Sidebar primitives
export {
  SidebarBrand,
  SidebarNav,
  SidebarSection,
  SidebarFooter,
  NavItem,
} from './components/Sidebar'
export type { NavItemProps } from './components/Sidebar'

// Hub switcher (cross-hub nav in AppShellHeader)
export { HubSwitcher } from './components/HubSwitcher'
export type { Hub, HubType } from './components/HubSwitcher'

// Wizard progress indicator (used by every multi-step flow)
export { WizardStepper } from './components/WizardStepper'
export type { WizardStep } from './components/WizardStepper'

// In-page sub-nav (used as page-header tab strip on vendors / violations /
// documents / legal / accounting).
export { Tabs } from './components/Tabs'
export type { TabsProps, TabItem } from './components/Tabs'

export { Select } from './components/Select'
export type { SelectProps } from './components/Select'
export { PageHeader } from './components/PageHeader'
export type { PageHeaderProps } from './components/PageHeader'
export { BackLink } from './components/BackLink'
export type { BackLinkProps } from './components/BackLink'
export { KeyValue, KeyValueList } from './components/KeyValue'
export type { KeyValueProps, KeyValueListProps } from './components/KeyValue'

// Modal confirm for destructive actions — replaces window.confirm.
export { ConfirmProvider, useConfirm } from './components/Confirm'
export type { ConfirmOptions } from './components/Confirm'

// Transient toast notifications for mutation feedback.
export { ToastProvider, useToast } from './components/Toast'
export type { ToastOptions } from './components/Toast'
