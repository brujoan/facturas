import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import InvoiceApp from "@/components/InvoiceApp";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";
import { APP_VERSION } from "@/lib/version";

export default async function Home() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;

  if (!verifySessionToken(token)) {
    redirect("/login");
  }

  const deployment =
    process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ||
    process.env.VERCEL_URL?.split(".")[0] ||
    "local";

  return <InvoiceApp version={APP_VERSION} deployment={deployment} />;
}
