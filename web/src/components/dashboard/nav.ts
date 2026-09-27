import { ArrowRightLeft, LayoutGrid, Receipt, Settings, Sparkles, type LucideIcon } from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

export const NAV: readonly NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutGrid },
  { href: "/dashboard/invoices", label: "Products & invoices", icon: Receipt },
  { href: "/dashboard/transactions", label: "Transactions", icon: ArrowRightLeft },
  { href: "/dashboard/ai-assistant", label: "SolAgent AI assistant", icon: Sparkles },
  { href: "/dashboard/settings", label: "Settings", icon: Settings },
];

/** The fullscreen PoS register: outside the nav, with none of the dashboard around it. */
export const POS_PATH = "/dashboard/pos";

export function isActive(pathname: string, href: string): boolean {
  return href === "/dashboard" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
}

/** The nav section for a sub-route, or undefined on the overview. */
export function sectionFor(pathname: string): NavItem | undefined {
  return NAV.find((item) => item.href !== "/dashboard" && isActive(pathname, item.href));
}
