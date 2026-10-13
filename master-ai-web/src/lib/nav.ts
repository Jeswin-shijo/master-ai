import {
  Bot,
  BookOpen,
  Database,
  FileText,
  FolderKanban,
  Home,
  Inbox,
  Package,
  Phone,
  Repeat,
  ScrollText,
  Settings,
  Users,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import type { HumanRole } from '@onehuman/schemas';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
  /** Only the owner and admins change these. */
  managersOnly?: boolean;
}

export const NAV: NavItem[] = [
  { to: '/', label: 'Home', icon: Home, end: true },
  { to: '/cases', label: 'Cases', icon: FolderKanban },
  { to: '/approvals', label: 'Approvals', icon: Inbox },
  { to: '/team', label: 'Team', icon: Users },
  { to: '/routines', label: 'Routines', icon: Repeat },
  { to: '/calls', label: 'Calls', icon: Phone },
  { to: '/reports', label: 'Reports', icon: FileText },
  { to: '/knowledge', label: 'Knowledge', icon: BookOpen },
  { to: '/workflows', label: 'Workflows', icon: Workflow, managersOnly: true },
  { to: '/agents', label: 'Agents', icon: Bot, managersOnly: true },
  { to: '/records', label: 'Records', icon: Database, managersOnly: true },
  { to: '/pack', label: 'Industry pack', icon: Package, managersOnly: true },
  { to: '/audit', label: 'Audit', icon: ScrollText, managersOnly: true },
  { to: '/settings', label: 'Settings', icon: Settings, managersOnly: true },
];

export function navFor(role: HumanRole | undefined): NavItem[] {
  const manager = role === 'owner' || role === 'admin';
  return NAV.filter((i) => !i.managersOnly || manager);
}
