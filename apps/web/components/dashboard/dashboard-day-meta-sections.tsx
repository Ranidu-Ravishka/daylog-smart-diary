import { FileText, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import type { DashboardDay } from "@/lib/types/dashboard";

type DashboardDayMetaSectionsProps = {
  day: DashboardDay | undefined;
};

export function DashboardDayMetaSections({
  day,
}: DashboardDayMetaSectionsProps) {
  return (
    <>
      {day?.manualNotes && day.manualNotes.length > 0 && (
        <section className="mb-8">
          <div className="mb-3 flex items-center gap-2">
            <FileText className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-medium">Notes</h2>
          </div>
          <Card>
            <CardContent className="p-5">
              <ul className="space-y-1.5">
                {day.manualNotes.map((note, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-2 text-sm text-muted-foreground"
                  >
                    <span className="mt-1.5 block h-1 w-1 shrink-0 rounded-full bg-primary" />
                    {note}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </section>
      )}

      {day?.peopleTags && day.peopleTags.length > 0 && (
        <section>
          <div className="mb-3 flex items-center gap-2">
            <Users className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-medium">People</h2>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {day.peopleTags.map((person, i) => (
              <Badge key={i} variant="outline">
                {person}
              </Badge>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
