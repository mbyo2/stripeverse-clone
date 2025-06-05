
import React, { useState } from 'react';
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Code2, FileDown, RefreshCw } from "lucide-react";

interface SdkInfo {
  language: string;
  description: string;
  version: string;
  installCmd: string;
  packageName: string;
  repository: string;
  documentation: string;
}

export function SdkDocs() {
  const [sdks, setSdks] = useState<SdkInfo[]>([
    {
      language: "JavaScript",
      description: "Node.js and browser SDK",
      version: "v1.2.0",
      installCmd: "npm install @bmaglass/payments-js",
      packageName: "@bmaglass/payments-js",
      repository: "https://github.com/bmaglass/payments-js",
      documentation: "https://docs.bmaglass.com/js"
    },
    {
      language: "Python",
      description: "Python SDK for server-side integration",
      version: "v1.1.0",
      installCmd: "pip install bmaglass-payments",
      packageName: "bmaglass-payments",
      repository: "https://github.com/bmaglass/payments-python",
      documentation: "https://docs.bmaglass.com/python"
    },
    {
      language: "PHP",
      description: "PHP SDK with Laravel support",
      version: "v1.0.0",
      installCmd: "composer require bmaglass/payments",
      packageName: "bmaglass/payments",
      repository: "https://github.com/bmaglass/payments-php",
      documentation: "https://docs.bmaglass.com/php"
    },
    {
      language: "Go",
      description: "Go SDK for high-performance applications",
      version: "v0.9.0",
      installCmd: "go get github.com/bmaglass/payments-go",
      packageName: "github.com/bmaglass/payments-go",
      repository: "https://github.com/bmaglass/payments-go",
      documentation: "https://docs.bmaglass.com/go"
    }
  ]);

  const [isLoading, setIsLoading] = useState(false);

  const updateSdk = (index: number, updates: Partial<SdkInfo>) => {
    setSdks(prev => prev.map((sdk, i) => 
      i === index ? { ...sdk, ...updates } : sdk
    ));
  };

  const refreshVersions = async () => {
    setIsLoading(true);
    // Simulate API call to fetch latest versions
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    setSdks(prev => prev.map(sdk => ({
      ...sdk,
      version: `v${(parseFloat(sdk.version.slice(1)) + 0.1).toFixed(1)}`
    })));
    
    setIsLoading(false);
  };

  const generateInstallCommand = (sdk: SdkInfo, packageManager?: string) => {
    switch (sdk.language.toLowerCase()) {
      case 'javascript':
        return packageManager === 'yarn' 
          ? `yarn add ${sdk.packageName}`
          : packageManager === 'pnpm'
          ? `pnpm add ${sdk.packageName}`
          : sdk.installCmd;
      case 'python':
        return packageManager === 'poetry'
          ? `poetry add ${sdk.packageName}`
          : sdk.installCmd;
      default:
        return sdk.installCmd;
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>SDK Downloads</CardTitle>
            <CardDescription>Official client libraries for popular languages</CardDescription>
          </div>
          <Button 
            variant="outline" 
            size="sm" 
            onClick={refreshVersions}
            disabled={isLoading}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh Versions
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {sdks.map((sdk, index) => (
            <div key={sdk.language} className="flex items-center justify-between p-4 border rounded-lg">
              <div className="flex-1">
                <h3 className="font-medium">{sdk.language}</h3>
                <p className="text-sm text-muted-foreground">{sdk.description}</p>
                <div className="mt-2 space-y-1">
                  <code className="text-xs bg-secondary/20 px-2 py-1 rounded block">
                    {generateInstallCommand(sdk)}
                  </code>
                  {sdk.language === 'JavaScript' && (
                    <>
                      <code className="text-xs bg-secondary/20 px-2 py-1 rounded block">
                        {generateInstallCommand(sdk, 'yarn')}
                      </code>
                      <code className="text-xs bg-secondary/20 px-2 py-1 rounded block">
                        {generateInstallCommand(sdk, 'pnpm')}
                      </code>
                    </>
                  )}
                  {sdk.language === 'Python' && (
                    <code className="text-xs bg-secondary/20 px-2 py-1 rounded block">
                      {generateInstallCommand(sdk, 'poetry')}
                    </code>
                  )}
                </div>
                <div className="mt-2 flex gap-2">
                  <a 
                    href={sdk.repository} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="text-xs text-blue-500 hover:underline"
                  >
                    Repository
                  </a>
                  <a 
                    href={sdk.documentation} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="text-xs text-blue-500 hover:underline"
                  >
                    Documentation
                  </a>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className="text-right">
                  <span className="text-xs text-muted-foreground block">{sdk.version}</span>
                  <input
                    type="text"
                    value={sdk.version}
                    onChange={(e) => updateSdk(index, { version: e.target.value })}
                    className="text-xs border rounded px-1 w-16 mt-1"
                  />
                </div>
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
