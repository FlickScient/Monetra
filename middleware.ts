import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

// Native Capacitor requests use bearer session tokens from their own app origin.
// Add these origins to Clerk Dashboard > Configure > Domains / Allowed origins too.
const nativeOrigins = new Set(["capacitor://localhost", "https://localhost"]);
const webOrigins = new Set(["https://monetra-4rax.vercel.app"]);

const isPublicRoute = createRouteMatcher([
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/api/ai/context",
]);

export default clerkMiddleware((auth, req) => {
  const origin = req.headers.get("origin") || "";
  const allowedOrigin = nativeOrigins.has(origin) || webOrigins.has(origin);

  if (req.method === "OPTIONS" && allowedOrigin && req.nextUrl.pathname.startsWith("/api/")) {
    return new NextResponse(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Workspace-Id, Idempotency-Key",
        "Access-Control-Max-Age": "86400",
        "Vary": "Origin",
      },
    });
  }

  if (!isPublicRoute(req)) auth().protect();

  const response = NextResponse.next();
  if (allowedOrigin && req.nextUrl.pathname.startsWith("/api/")) {
    response.headers.set("Access-Control-Allow-Origin", origin);
    response.headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
    response.headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Workspace-Id, Idempotency-Key");
    response.headers.set("Vary", "Origin");
  }
  return response;
});

export const config = {
  matcher: ["/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)", "/(api|trpc)(.*)"],
};
