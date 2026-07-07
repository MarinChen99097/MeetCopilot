import { createNavigation } from "next-intl/navigation";
import { routing } from "./routing";

// locale-aware wrappers: Link/redirect/usePathname/useRouter/getPathname auto-handle the [locale] prefix.
export const { Link, redirect, usePathname, useRouter, getPathname } = createNavigation(routing);
