import { FileText, Users } from "lucide-react";
import { DashboardSectionLabel } from "@/components/dashboard/dashboard-section-label";
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
        <section className="mb-10">
          <DashboardSectionLabel icon={FileText} title="Notes" />
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
          <DashboardSectionLabel icon={Users} title="People" />
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
