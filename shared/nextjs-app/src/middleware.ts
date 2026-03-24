import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";

export default withAuth(
  function middleware(req) {
    const token = req.nextauth.token;
    const path = req.nextUrl.pathname;

    // Public API endpoints — allow unauthenticated access
    if (path.startsWith("/api/health")) {
      return NextResponse.next();
    }

    // Admin-only routes
    if (path.startsWith("/admin") || path.startsWith("/monitoring")) {
      const groups = (token?.groups as string[]) ?? [];
      if (!groups.includes("admin")) {
        return NextResponse.redirect(new URL("/", req.url));
      }
    }

    return NextResponse.next();
  },
  {
    callbacks: {
      authorized: ({ token, req }) => {
        // Allow unauthenticated access to /api/health
        if (req.nextUrl.pathname.startsWith("/api/health")) return true;
        return !!token;
      },
    },
  }
);

export const config = {
  matcher: [
    "/analytics/:path*",
    "/monitoring/:path*",
    "/admin/:path*",
    "/api/:path*",
    "/",
  ],
};
