import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import HomeDashboard from "./home-dashboard";

export default async function HomePage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/api/auth/signin");

  return <HomeDashboard isAdmin={session.user.isAdmin} />;
}
