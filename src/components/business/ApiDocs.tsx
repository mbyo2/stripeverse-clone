
import { Building2, Users, CreditCard } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent
} from "@/components/ui/card";

export function ApiDocs() {
  return (
    <div className="p-4 border rounded-md">
      <h3 className="font-medium mb-3">Documentation & Resources</h3>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4 flex flex-col items-center text-center">
            <div className="bg-primary/10 p-3 rounded-full mb-3">
              <Building2 className="h-6 w-6 text-primary" />
            </div>
            <h4 className="font-medium mb-2">API Documentation</h4>
            <p className="text-sm text-muted-foreground mb-3">
              Comprehensive API docs with examples
            </p>
            <Button variant="outline" size="sm" className="mt-auto">View Docs</Button>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 flex flex-col items-center text-center">
            <div className="bg-primary/10 p-3 rounded-full mb-3">
              <Users className="h-6 w-6 text-primary" />
            </div>
            <h4 className="font-medium mb-2">SDK Downloads</h4>
            <p className="text-sm text-muted-foreground mb-3">
              Client libraries for popular languages
            </p>
            <Button variant="outline" size="sm" className="mt-auto">Download</Button>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 flex flex-col items-center text-center">
            <div className="bg-primary/10 p-3 rounded-full mb-3">
              <CreditCard className="h-6 w-6 text-primary" />
            </div>
            <h4 className="font-medium mb-2">Testing Guide</h4>
            <p className="text-sm text-muted-foreground mb-3">
              Learn how to test our integration
            </p>
            <Button variant="outline" size="sm" className="mt-auto">View Guide</Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
