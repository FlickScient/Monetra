import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// The internal Fiscus context endpoint is excluded from Clerk cookie middleware
// because it authenticates Supabase-to-Vercel requests with a timestamped HMAC.
const isPublicRoute = createRouteMatcher([
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/api/ai/context",
  // Native Capacitor clients authenticate this endpoint with a Clerk bearer token;
  // the route handler still enforces auth() and filters every row by userId.
  "/api/workspaces",
]);

export default clerkMiddleware((auth, req) => {
  if (!isPublicRoute(req)) auth().protect();
});

export const config = {
  matcher: ["/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)", "/(api|trpc)(.*)"],
};
