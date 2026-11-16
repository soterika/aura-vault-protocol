import { createNavigation } from "next-intl/navigation";
import { routing } from "./routing";

// Locale-aware navigation primitives (drop-in replacements for next/navigation)
export const { Link, redirect, usePathname, useRouter, getPathname } =
  createNavigation(routing);
