import type { LucideIcon } from "lucide-react";
import {
  Activity,
  Archive,
  BookOpen,
  Calendar,
  FileText,
  Flag,
  LayoutDashboard,
  Plug,
  Radio,
  ScrollText,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Users,
} from "lucide-react";

export type AdminNavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
};

export type AdminNavSection = {
  title: string;
  items: AdminNavItem[];
};

export const adminNavSections: AdminNavSection[] = [
  {
    title: "Overview",
    items: [
      {
        href: "/admin/dashboard",
        label: "Dashboard",
        icon: LayoutDashboard,
      },
    ],
  },
  {
    title: "Product",
    items: [
      { href: "/feature-flags", label: "Feature Flags", icon: Flag },
      { href: "/content", label: "Content", icon: FileText },
      { href: "/users", label: "Users", icon: Users },
      { href: "/memories", label: "Memories", icon: Sparkles },
      { href: "/days", label: "Days", icon: Calendar },
      { href: "/summaries", label: "Summaries", icon: BookOpen },
      {
        href: "/summaries/quality",
        label: "Summary Quality",
        icon: ShieldCheck,
      },
    ],
  },
  {
    title: "Integrations",
    items: [
      { href: "/integrations", label: "Integrations", icon: Plug },
      {
        href: "/integrations/health",
        label: "Integration Health",
        icon: Activity,
      },
    ],
  },
  {
    title: "Operations",
    items: [
      {
        href: "/observability/info-events",
        label: "Info Transport",
        icon: Radio,
      },
      { href: "/retention", label: "Retention", icon: Archive },
      { href: "/preferences", label: "Preferences", icon: SlidersHorizontal },
      { href: "/audit-logs", label: "Audit Logs", icon: ScrollText },
    ],
  },
];
