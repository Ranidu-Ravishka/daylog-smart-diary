"use client";

import { useQuery, useMutation } from "convex/react";
import { api } from "@repo/backend/convex";
import { useState } from "react";

export default function ConvexDemo() {
  const [inputValue, setInputValue] = useState("");
  const data = useQuery(api.myFunctions.myQuery, {
    first: 99,
    second: "Admin App",
  });
  const myMutation = useMutation(api.myFunctions.myMutation);

  const handleMutation = async () => {
    await myMutation({
      first: Math.random() * 100,
      second: inputValue || "Hello from Admin!",
    });
  };

  return (
    <div className="p-8 max-w-2xl mx-auto">
      <h1 className="text-3xl font-bold mb-6">
        Admin App - Convex Integration Demo
      </h1>

      <div className="mt-5 p-4 bg-gray-100 rounded-lg">
        <h2 className="text-xl font-semibold mb-2">Query Result:</h2>
        <pre className="bg-white p-3 rounded overflow-auto">
          {JSON.stringify(data, null, 2)}
        </pre>
      </div>

      <div className="mt-5">
        <h2 className="text-xl font-semibold mb-3">Test Mutation:</h2>
        <input
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          placeholder="Enter a message"
          className="border p-2 mr-2 rounded w-80"
        />
        <button
          onClick={handleMutation}
          className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
        >
          Send Mutation
        </button>
      </div>

      <div className="mt-5 p-4 bg-blue-50 rounded">
        <p className="font-bold">✅ Convex is connected!</p>
        <p className="mt-2">
          This component is using the shared Convex backend from{" "}
          <code className="bg-gray-200 px-1 rounded">packages/backend</code>
        </p>
      </div>
    </div>
  );
}
