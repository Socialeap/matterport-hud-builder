import { createFileRoute } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Play, ExternalLink } from "lucide-react";

export const Route = createFileRoute("/_authenticated/dashboard/demo")({
  component: DemoPage,
});

const sampleProperties = [
  { address: "742 Evergreen Terrace", city: "Springfield", sqft: "2,200", price: "$425,000" },
  { address: "221B Baker Street", city: "London", sqft: "1,800", price: "$890,000" },
  { address: "1600 Pennsylvania Ave", city: "Washington DC", sqft: "55,000", price: "$400M" },
];

function DemoPage() {
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Demo Mode</h1>
        <p className="text-sm text-muted-foreground">
          Preview the marketing toolkit with sample data. No real tours are created.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Play className="size-5 text-primary" />
            Sample Properties
          </CardTitle>
          <CardDescription>
            These sample properties demonstrate how the HUD builder and tour generation work.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {sampleProperties.map((prop) => (
              <div
                key={prop.address}
                className="flex items-center justify-between rounded-lg border border-border p-4"
              >
                <div>
                  <p className="font-medium text-foreground">{prop.address}</p>
                  <p className="text-sm text-muted-foreground">
                    {prop.city} · {prop.sqft} sqft
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <Badge variant="secondary">{prop.price}</Badge>
                  <Button size="sm" variant="outline">
                    <ExternalLink className="mr-1 size-3" />
                    Preview
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card className="border-dashed border-primary/30 bg-primary/5">
        <CardContent className="py-8 text-center">
          <h3 className="text-lg font-semibold text-foreground">
            Full Builder Coming Soon
          </h3>
          <p className="mt-2 text-sm text-muted-foreground">
            The interactive HUD builder with property management, music selection,
            and tour behavior configuration is being ported from the legacy codebase.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
