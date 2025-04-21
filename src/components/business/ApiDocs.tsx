
import React from "react";
import { ApiReference } from "./docs/ApiReference";
import { SdkDocs } from "./docs/SdkDocs";
import { TestingGuide } from "./docs/TestingGuide";
import { WebhookDocs } from "./docs/WebhookDocs";
import { Building2, Users, CreditCard, Webhook } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export function ApiDocs() {
  return (
    <div className="p-4 border rounded-md">
      <h3 className="font-medium mb-3">Documentation & Resources</h3>
      
      <Tabs defaultValue="api" className="space-y-4">
        <TabsList>
          <TabsTrigger value="api">
            <Building2 className="h-4 w-4 mr-2" />
            API Reference
          </TabsTrigger>
          <TabsTrigger value="sdks">
            <Users className="h-4 w-4 mr-2" />
            SDKs
          </TabsTrigger>
          <TabsTrigger value="webhooks">
            <Webhook className="h-4 w-4 mr-2" />
            Webhooks
          </TabsTrigger>
          <TabsTrigger value="testing">
            <CreditCard className="h-4 w-4 mr-2" />
            Testing
          </TabsTrigger>
        </TabsList>

        <TabsContent value="api">
          <ApiReference />
        </TabsContent>

        <TabsContent value="sdks">
          <SdkDocs />
        </TabsContent>

        <TabsContent value="webhooks">
          <WebhookDocs />
        </TabsContent>

        <TabsContent value="testing">
          <TestingGuide />
        </TabsContent>
      </Tabs>
    </div>
  );
}
