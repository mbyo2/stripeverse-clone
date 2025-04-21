
import React from 'react';
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Code2, FileDown } from "lucide-react";

export function SdkDocs() {
  const sdks = [
    {
      language: "JavaScript",
      description: "Node.js and browser SDK",
      version: "v1.2.0",
      installCmd: "npm install @bmaglass/payments-js"
    },
    {
      language: "Python",
      description: "Python SDK for server-side integration",
      version: "v1.1.0",
      installCmd: "pip install bmaglass-payments"
    },
    {
      language: "PHP",
      description: "PHP SDK with Laravel support",
      version: "v1.0.0",
      installCmd: "composer require bmaglass/payments"
    }
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>SDK Downloads</CardTitle>
        <CardDescription>Official client libraries for popular languages</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {sdks.map((sdk) => (
            <div key={sdk.language} className="flex items-center justify-between p-4 border rounded-lg">
              <div>
                <h3 className="font-medium">{sdk.language}</h3>
                <p className="text-sm text-muted-foreground">{sdk.description}</p>
                <div className="mt-2">
                  <code className="text-xs bg-secondary/20 px-2 py-1 rounded">
                    {sdk.installCmd}
                  </code>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">{sdk.version}</span>
                <Button variant="outline" size="sm">
                  <FileDown className="h-4 w-4 mr-2" />
                  Download
                </Button>
              </div>
            </div>
          ))}
        </div>
        
        <div className="mt-6 flex justify-between items-center">
          <Button variant="outline" className="flex items-center">
            <Code2 className="h-4 w-4 mr-2" />
            View on GitHub
          </Button>
          <span className="text-xs text-muted-foreground">
            MIT License
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
