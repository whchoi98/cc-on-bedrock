"use client";

import type { ContainerInfo } from "@/lib/types";

interface ContainersTableProps {
  containers: ContainerInfo[];
  onStop?: (taskArn: string) => void;
  domainName?: string;
  devSubdomain?: string;
}

const statusColors: Record<string, string> = {
  RUNNING: "bg-green-100 text-green-700",
  PENDING: "bg-yellow-100 text-yellow-700",
  PROVISIONING: "bg-yellow-100 text-yellow-700",
  STOPPED: "bg-gray-100 text-gray-500",
  DEPROVISIONING: "bg-orange-100 text-orange-700",
  STOPPING: "bg-orange-100 text-orange-700",
};

export default function ContainersTable({
  containers,
  onStop,
  domainName = "example.com",
  devSubdomain = "dev",
}: ContainersTableProps) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50">
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                User / Subdomain
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Status
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Config
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Resources
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Started
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                URL
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {containers.map((container) => {
              const url = `https://${container.subdomain}.${devSubdomain}.${domainName}`;
              return (
                <tr key={container.taskArn} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div>
                      <p className="text-sm font-medium text-gray-900">
                        {container.username || "Unknown"}
                      </p>
                      <p className="text-xs text-gray-500">
                        {container.subdomain || container.taskId}
                      </p>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span
                      className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${
                        statusColors[container.status] ??
                        "bg-gray-100 text-gray-700"
                      }`}
                    >
                      {container.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">
                    <div className="flex gap-1">
                      <span className="inline-flex px-1.5 py-0.5 text-xs bg-gray-100 rounded">
                        {container.containerOs === "al2023"
                          ? "AL2023"
                          : "Ubuntu"}
                      </span>
                      <span className="inline-flex px-1.5 py-0.5 text-xs bg-gray-100 rounded">
                        {container.resourceTier}
                      </span>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-xs text-gray-500">
                    {container.cpu} vCPU / {container.memory} MiB
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-xs text-gray-500">
                    {container.startedAt
                      ? new Date(container.startedAt).toLocaleString()
                      : "-"}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {container.status === "RUNNING" && container.subdomain ? (
                      <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-primary-600 hover:underline"
                      >
                        {url}
                      </a>
                    ) : (
                      <span className="text-xs text-gray-400">-</span>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right">
                    {onStop &&
                      (container.status === "RUNNING" ||
                        container.status === "PENDING") && (
                        <button
                          onClick={() => onStop(container.taskArn)}
                          className="px-3 py-1 text-xs font-medium text-red-600 hover:bg-red-50 rounded"
                        >
                          Stop
                        </button>
                      )}
                  </td>
                </tr>
              );
            })}
            {containers.length === 0 && (
              <tr>
                <td
                  colSpan={7}
                  className="px-6 py-12 text-center text-sm text-gray-500"
                >
                  No containers running.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
