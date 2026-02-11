import { auth } from "@clerk/nextjs/server";

export default async function AdminDashboardPage() {
  const { userId } = await auth();

  return (
    <div className="min-h-screen bg-gray-50 py-10">
      <div className="max-w-5xl mx-auto px-6">
        <h1 className="text-2xl font-semibold text-gray-900">Dashboard</h1>
        <p className="mt-2 text-sm text-gray-600">
          Signed in as <span className="font-mono">{userId}</span>
        </p>
      </div>
    </div>
  );
}
