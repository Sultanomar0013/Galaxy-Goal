import { NextResponse, type NextRequest } from "next/server";

// Optimistic check only (no DB here): requests with no session cookie go to /login.
// Whether a cookie is actually valid is decided by src/lib/dal.ts; the auth pages send
// already-logged-in users home themselves, so a stale cookie can't cause a redirect loop.
const PUBLIC_PAGES = ["/login", "/signup", "/verify"];

export default function proxy(req: NextRequest) {
  const path = req.nextUrl.pathname;
  // shared galaxy links (/g/<slug>) are public on purpose
  if (!req.cookies.has("gg_session") && !PUBLIC_PAGES.includes(path) && !path.startsWith("/g/")) {
    return NextResponse.redirect(new URL("/login", req.nextUrl));
  }
  return NextResponse.next();
}

export const config = {
  // static files (icons, the service worker, the app manifest) load without a session
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\.(?:png|svg|jpg|ico|js|webmanifest)$).*)"],
};
