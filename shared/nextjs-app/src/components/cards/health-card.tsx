import type { HealthStatus } from "@/lib/types";

const statusConfig = {
  healthy: {
    bg: "bg-green-50",
    text: "text-green-700",
    dot: "bg-green-500",
    label: "Healthy",
  },
  degraded: {
    bg: "bg-yellow-50",
    text: "text-yellow-700",
    dot: "bg-yellow-500",
    label: "Degraded",
  },
  unhealthy: {
    bg: "bg-red-50",
    text: "text-red-700",
    dot: "bg-red-500",
    label: "Unhealthy",
  },
};

export default function HealthCard({
  service,
  status,
  message,
  lastChecked,
}: HealthStatus) {
  const config = statusConfig[status];

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-gray-900">{service}</h3>
        <span
          className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full ${config.bg} ${config.text}`}
        >
          <span className={`w-1.5 h-1.5 rounded-full ${config.dot}`} />
          {config.label}
        </span>
      </div>
      {message && <p className="mt-2 text-sm text-gray-500">{message}</p>}
      <p className="mt-3 text-xs text-gray-400">
        Last checked: {new Date(lastChecked).toLocaleTimeString()}
      </p>
    </div>
  );
}
