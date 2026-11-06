"use client";

import { useAction } from "convex/react";
import { api } from "@repo/backend/convex";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export function DashboardAskYourDay() {
  const askYourDay = useAction(api.aiBrain.askYourDay);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<{
    answer: string;
    evidence: string[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  async function submitQuestion() {
    const trimmed = question.trim();
    if (!trimmed || isLoading) return;
    setError(null);
    setIsLoading(true);
    try {
      const result = await askYourDay({ question: trimmed });
      setAnswer(result);
    } catch {
      setError("Ask Your Day is temporarily unavailable. Please try again.");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <section className="mb-10">
      <Card>
        <CardContent className="space-y-4 p-5">
          <div>
            <h2 className="text-base font-semibold">Ask Your Day</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              DayLog sends relevant diary context to OpenAI to answer your
              question. Answers can be wrong; avoid adding unnecessary
              sensitive information.
            </p>
          </div>
          <textarea
            value={question}
            onChange={(event) => setQuestion(event.target.value.slice(0, 500))}
            placeholder="What patterns have I noticed recently?"
            rows={3}
            className="w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            aria-label="Ask Your Day question"
          />
          <Button
            onClick={submitQuestion}
            disabled={isLoading || question.trim().length === 0}
          >
            {isLoading ? "Thinking..." : "Ask"}
          </Button>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          {answer ? (
            <div className="space-y-3 border-t border-border pt-4">
              <p className="text-sm leading-relaxed">{answer.answer}</p>
              {answer.evidence.length > 0 ? (
                <ul className="space-y-1 text-xs text-muted-foreground">
                  {answer.evidence.map((item, index) => (
                    <li key={`${item}-${index}`}>- {item}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </CardContent>
      </Card>
    </section>
  );
}
