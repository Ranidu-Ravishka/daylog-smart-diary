"use client";

import { useQuery, useMutation } from "convex/react";
import { api } from "@repo/backend/convex";
import { useState } from "react";

export default function ConvexDemo() {
  const [inputValue, setInputValue] = useState("");
  const data = useQuery(api.myFunctions.myQuery, {
    first: 42,
    second: "Web App",
  });
  const myMutation = useMutation(api.myFunctions.myMutation);

  const handleMutation = async () => {
    await myMutation({
      first: Math.random() * 100,
      second: inputValue || "Hello from Web!",
    });
  };

  return (
    <div style={{ padding: "20px", maxWidth: "600px", margin: "0 auto" }}>
      <h1>Web App - Convex Integration Demo</h1>

      <div
        style={{
          marginTop: "20px",
          padding: "15px",
          background: "#f5f5f5",
          borderRadius: "8px",
        }}
      >
        <h2>Query Result:</h2>
        <pre>{JSON.stringify(data, null, 2)}</pre>
      </div>

      <div style={{ marginTop: "20px" }}>
        <h2>Test Mutation:</h2>
        <input
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          placeholder="Enter a message"
          style={{ padding: "8px", marginRight: "10px", width: "300px" }}
        />
        <button
          onClick={handleMutation}
          style={{ padding: "8px 16px", cursor: "pointer" }}
        >
          Send Mutation
        </button>
      </div>

      <div
        style={{
          marginTop: "20px",
          padding: "10px",
          background: "#e3f2fd",
          borderRadius: "4px",
        }}
      >
        <p>
          <strong>✅ Convex is connected!</strong>
        </p>
        <p>
          This component is using the shared Convex backend from{" "}
          <code>packages/backend</code>
        </p>
      </div>
    </div>
  );
}
