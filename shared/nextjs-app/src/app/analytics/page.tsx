import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import AnalyticsDashboard from "./analytics-dashboard";

export default async function AnalyticsPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/api/auth/signin");

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Analytics</h1>
        <p className="mt-1 text-sm text-gray-500">
          Token usage, model metrics, and cost tracking
        </p>
      </div>
      <AnalyticsDashboard isAdmin={session.user.isAdmin} />
    </div>
  );
}
