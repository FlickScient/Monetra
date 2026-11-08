import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// API handlers perform their own authentication. This permits native requests
// to reach them with a Clerk bearer token; browser requests continue to use
// Clerk cookies. Every finance API route resolves ownership through
// getWorkspaceContext(), while /api/ai/context validates its own HMAC.
const isPublicRoute = createRouteMatcher([
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/api/(.*)",
]);

export default clerkMiddleware((auth, req) => {
  if (!isPublicRoute(req)) auth().protect();
});

export const config = {
  matcher: ["/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)", "/(api|trpc)(.*)"],
};
