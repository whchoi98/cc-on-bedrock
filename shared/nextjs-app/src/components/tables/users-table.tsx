"use client";

import { useState } from "react";
import type { CognitoUser } from "@/lib/types";

interface UsersTableProps {
  users: CognitoUser[];
  onDelete?: (username: string) => void;
  onToggle?: (username: string, enabled: boolean) => void;
}

const tierBadge: Record<string, string> = {
  light: "bg-gray-100 text-gray-700",
  standard: "bg-blue-100 text-blue-700",
  power: "bg-purple-100 text-purple-700",
};

const policyBadge: Record<string, string> = {
  open: "bg-green-100 text-green-700",
  restricted: "bg-yellow-100 text-yellow-700",
  locked: "bg-red-100 text-red-700",
};

const statusBadge: Record<string, string> = {
  CONFIRMED: "bg-green-100 text-green-700",
  FORCE_CHANGE_PASSWORD: "bg-yellow-100 text-yellow-700",
  DISABLED: "bg-gray-100 text-gray-500",
};

export default function UsersTable({
  users,
  onDelete,
  onToggle,
}: UsersTableProps) {
  const [search, setSearch] = useState("");

  const filtered = users.filter(
    (u) =>
      u.email.toLowerCase().includes(search.toLowerCase()) ||
      u.subdomain.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      {/* Search */}
      <div className="px-6 py-4 border-b border-gray-200">
        <input
          type="text"
          placeholder="Search users by email or subdomain..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full max-w-sm px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
        />
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50">
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                User
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Subdomain
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                OS
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Tier
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Security
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Status
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {filtered.map((user) => (
              <tr key={user.username} className="hover:bg-gray-50">
                <td className="px-6 py-4 whitespace-nowrap">
                  <div>
                    <p className="text-sm font-medium text-gray-900">
                      {user.email}
                    </p>
                    <p className="text-xs text-gray-500">{user.username}</p>
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">
                  {user.subdomain}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">
                  {user.containerOs === "al2023"
                    ? "Amazon Linux"
                    : "Ubuntu"}
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span
                    className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${
                      tierBadge[user.resourceTier] ?? tierBadge.standard
                    }`}
                  >
                    {user.resourceTier}
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span
                    className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${
                      policyBadge[user.securityPolicy] ??
                      policyBadge.restricted
                    }`}
                  >
                    {user.securityPolicy}
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span
                    className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${
                      statusBadge[user.status] ?? "bg-gray-100 text-gray-700"
                    }`}
                  >
                    {user.status === "FORCE_CHANGE_PASSWORD"
                      ? "Pending"
                      : user.enabled
                      ? user.status
                      : "Disabled"}
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-right text-sm">
                  <div className="flex items-center justify-end gap-2">
                    {onToggle && (
                      <button
                        onClick={() =>
                          onToggle(user.username, !user.enabled)
                        }
                        className={`px-2 py-1 text-xs font-medium rounded ${
                          user.enabled
                            ? "text-yellow-700 hover:bg-yellow-50"
                            : "text-green-700 hover:bg-green-50"
                        }`}
                      >
                        {user.enabled ? "Disable" : "Enable"}
                      </button>
                    )}
                    {onDelete && (
                      <button
                        onClick={() => onDelete(user.username)}
                        className="px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 rounded"
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td
                  colSpan={7}
                  className="px-6 py-12 text-center text-sm text-gray-500"
                >
                  No users found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
