import createMiddleware from "next-intl/middleware";
import { routing } from "./src/i18n/routing";

// Handles locale detection, redirects, and alternate link headers
export default createMiddleware(routing);

export const config = {
  // Match all pathnames except Next.js internals and static files
  matcher: [
    "/((?!_next|_vercel|.*\\..*).*)",
  ],
};
