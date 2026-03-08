
import React, { useState } from 'react';
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  Code2, FileDown, RefreshCw, Copy, Check, ExternalLink, 
  Download, Star, GitBranch, Clock, Package, Terminal,
  ArrowRight, TrendingUp, Shield
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { motion } from "framer-motion";

interface SdkInfo {
  language: string;
  icon: string;
  description: string;
  version: string;
  installCommands: { manager: string; cmd: string }[];
  packageName: string;
  repository: string;
  documentation: string;
  downloads: string;
  stars: number;
  lastUpdated: string;
  changelog: string[];
  color: string;
}

const sdkData: SdkInfo[] = [
  {
    language: "JavaScript / Node.js",
    icon: "JS",
    description: "Full-stack SDK for browsers and Node.js with TypeScript support",
    version: "v2.1.0",
    installCommands: [
      { manager: "npm", cmd: "npm install @bmaglass/payments-js" },
      { manager: "yarn", cmd: "yarn add @bmaglass/payments-js" },
      { manager: "pnpm", cmd: "pnpm add @bmaglass/payments-js" },
    ],
    packageName: "@bmaglass/payments-js",
    repository: "https://github.com/bmaglass/payments-js",
    documentation: "https://docs.bmaglass.com/js",
    downloads: "45.2K",
    stars: 328,
    lastUpdated: "2 days ago",
    changelog: [
      "Added TypeScript 5.x support",
      "New retry logic with exponential backoff",
      "Fixed webhook signature verification edge case",
    ],
    color: "from-yellow-500/20 to-yellow-600/10",
  },
  {
    language: "Python",
    icon: "PY",
    description: "Server-side SDK with async support and Django/Flask integrations",
    version: "v1.8.0",
    installCommands: [
      { manager: "pip", cmd: "pip install bmaglass-payments" },
      { manager: "poetry", cmd: "poetry add bmaglass-payments" },
      { manager: "pipenv", cmd: "pipenv install bmaglass-payments" },
    ],
    packageName: "bmaglass-payments",
    repository: "https://github.com/bmaglass/payments-python",
    documentation: "https://docs.bmaglass.com/python",
    downloads: "28.7K",
    stars: 215,
    lastUpdated: "5 days ago",
    changelog: [
      "Added Python 3.12 support",
      "New async client with aiohttp",
      "Improved error messages and type hints",
    ],
    color: "from-blue-500/20 to-blue-600/10",
  },
  {
    language: "PHP",
    icon: "PHP",
    description: "PHP SDK with Laravel and Symfony support, Composer ready",
    version: "v1.5.0",
    installCommands: [
      { manager: "composer", cmd: "composer require bmaglass/payments-php" },
    ],
    packageName: "bmaglass/payments-php",
    repository: "https://github.com/bmaglass/payments-php",
    documentation: "https://docs.bmaglass.com/php",
    downloads: "18.3K",
    stars: 142,
    lastUpdated: "1 week ago",
    changelog: [
      "Added PHP 8.3 support",
      "Laravel 11 service provider",
      "New webhook middleware for Laravel",
    ],
    color: "from-indigo-500/20 to-indigo-600/10",
  },
  {
    language: "Go",
    icon: "GO",
    description: "High-performance SDK for Go microservices and APIs",
    version: "v1.2.0",
    installCommands: [
      { manager: "go", cmd: "go get github.com/bmaglass/payments-go" },
    ],
    packageName: "github.com/bmaglass/payments-go",
    repository: "https://github.com/bmaglass/payments-go",
    documentation: "https://docs.bmaglass.com/go",
    downloads: "8.1K",
    stars: 89,
    lastUpdated: "3 days ago",
    changelog: [
      "Added Go 1.22 support",
      "Context-based cancellation",
      "Improved connection pooling",
    ],
    color: "from-cyan-500/20 to-cyan-600/10",
  },
];

const CopyButton = ({ text }: { text: string }) => {
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();

  const copy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    toast({ title: "Copied to clipboard" });
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={copy}>
      {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
    </Button>
  );
};

export function SdkDocs() {
  const [isLoading, setIsLoading] = useState(false);
  const [activeTab, setActiveTab] = useState("overview");

  const refreshVersions = async () => {
    setIsLoading(true);
    await new Promise(resolve => setTimeout(resolve, 1200));
    setIsLoading(false);
  };

  const totalDownloads = "100K+";

  return (
    <div className="space-y-6">
      {/* Header Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "SDKs Available", value: "4", icon: Package, accent: "text-primary" },
          { label: "Total Downloads", value: totalDownloads, icon: Download, accent: "text-green-500" },
          { label: "Languages", value: "JS, PY, PHP, Go", icon: Code2, accent: "text-blue-500" },
          { label: "License", value: "MIT", icon: Shield, accent: "text-amber-500" },
        ].map((stat, i) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.08 }}
          >
            <Card className="border-border/60">
              <CardContent className="p-4 flex items-center gap-3">
                <div className="p-2 rounded-lg bg-muted">
                  <stat.icon className={`h-4 w-4 ${stat.accent}`} />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{stat.label}</p>
                  <p className="font-semibold text-sm">{stat.value}</p>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <div className="flex items-center justify-between">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="downloads">Downloads</TabsTrigger>
            <TabsTrigger value="changelogs">Changelogs</TabsTrigger>
          </TabsList>
          <Button
            variant="outline"
            size="sm"
            onClick={refreshVersions}
            disabled={isLoading}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>

        {/* OVERVIEW TAB */}
        <TabsContent value="overview" className="space-y-4">
          {sdkData.map((sdk, index) => (
            <motion.div
              key={sdk.language}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1 }}
            >
              <Card className="overflow-hidden hover:shadow-md transition-shadow">
                <div className={`h-1 bg-gradient-to-r ${sdk.color}`} />
                <CardContent className="p-5">
                  <div className="flex flex-col md:flex-row md:items-start gap-4">
                    {/* Icon & Info */}
                    <div className="flex items-start gap-4 flex-1 min-w-0">
                      <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${sdk.color} flex items-center justify-center font-bold text-sm shrink-0 border border-border/40`}>
                        {sdk.icon}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <h3 className="font-semibold">{sdk.language}</h3>
                          <Badge variant="outline" className="font-mono text-xs">{sdk.version}</Badge>
                          <span className="text-xs text-muted-foreground flex items-center gap-1">
                            <Clock className="h-3 w-3" /> {sdk.lastUpdated}
                          </span>
                        </div>
                        <p className="text-sm text-muted-foreground mb-3">{sdk.description}</p>
                        
                        {/* Install Command */}
                        <div className="bg-muted/50 rounded-lg p-3 border border-border/40">
                          <div className="flex items-center justify-between gap-2">
                            <code className="text-xs font-mono text-foreground truncate">
                              {sdk.installCommands[0].cmd}
                            </code>
                            <CopyButton text={sdk.installCommands[0].cmd} />
                          </div>
                        </div>

                        {/* Stats Row */}
                        <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Download className="h-3.5 w-3.5" /> {sdk.downloads}
                          </span>
                          <span className="flex items-center gap-1">
                            <Star className="h-3.5 w-3.5" /> {sdk.stars}
                          </span>
                          <span className="flex items-center gap-1">
                            <GitBranch className="h-3.5 w-3.5" /> {sdk.packageName}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex md:flex-col gap-2 shrink-0">
                      <Button size="sm" className="flex-1 md:flex-none">
                        <FileDown className="h-4 w-4 mr-1.5" />
                        Download
                      </Button>
                      <Button variant="outline" size="sm" className="flex-1 md:flex-none" asChild>
                        <a href={sdk.repository} target="_blank" rel="noopener noreferrer">
                          <ExternalLink className="h-4 w-4 mr-1.5" />
                          GitHub
                        </a>
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </TabsContent>

        {/* DOWNLOADS TAB */}
        <TabsContent value="downloads" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">SDK Downloads</CardTitle>
              <CardDescription>Install via your preferred package manager or download directly</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {sdkData.map((sdk) => (
                <div key={sdk.language} className="space-y-3">
                  <div className="flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${sdk.color} flex items-center justify-center font-bold text-xs border border-border/40`}>
                      {sdk.icon}
                    </div>
                    <div>
                      <h4 className="font-medium text-sm">{sdk.language}</h4>
                      <p className="text-xs text-muted-foreground">{sdk.version} • {sdk.downloads} downloads</p>
                    </div>
                  </div>
                  <div className="space-y-2 pl-11">
                    {sdk.installCommands.map((cmd) => (
                      <div key={cmd.manager} className="flex items-center gap-2 bg-muted/40 rounded-lg px-3 py-2 border border-border/30">
                        <Badge variant="secondary" className="text-[10px] font-mono shrink-0 uppercase">
                          {cmd.manager}
                        </Badge>
                        <code className="text-xs font-mono text-foreground flex-1 truncate">{cmd.cmd}</code>
                        <CopyButton text={cmd.cmd} />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Direct Download Cards */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Direct Downloads</CardTitle>
              <CardDescription>Download pre-built packages for offline installation</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {sdkData.map((sdk) => (
                  <div key={sdk.language} className="flex items-center justify-between p-4 rounded-xl border border-border/50 hover:border-primary/30 hover:bg-accent/30 transition-all group">
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-lg bg-gradient-to-br ${sdk.color} flex items-center justify-center font-bold text-xs border border-border/40`}>
                        {sdk.icon}
                      </div>
                      <div>
                        <p className="font-medium text-sm">{sdk.language}</p>
                        <p className="text-xs text-muted-foreground">{sdk.version} • .tar.gz</p>
                      </div>
                    </div>
                    <Button size="sm" variant="ghost" className="group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                      <Download className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* CHANGELOGS TAB */}
        <TabsContent value="changelogs" className="space-y-4">
          {sdkData.map((sdk) => (
            <Card key={sdk.language}>
              <CardHeader className="pb-3">
                <div className="flex items-center gap-3">
                  <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${sdk.color} flex items-center justify-center font-bold text-xs border border-border/40`}>
                    {sdk.icon}
                  </div>
                  <div>
                    <CardTitle className="text-base">{sdk.language} — {sdk.version}</CardTitle>
                    <CardDescription>Updated {sdk.lastUpdated}</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {sdk.changelog.map((entry, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm">
                      <div className="w-1.5 h-1.5 rounded-full bg-primary mt-2 shrink-0" />
                      <span className="text-muted-foreground">{entry}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))}
        </TabsContent>
      </Tabs>

      {/* Footer CTA */}
      <Card className="bg-gradient-to-r from-primary/5 to-primary/10 border-primary/20">
        <CardContent className="p-5 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div>
            <h4 className="font-semibold mb-1">Need a different language?</h4>
            <p className="text-sm text-muted-foreground">Use our REST API directly or request a new SDK on GitHub.</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" asChild>
              <a href="https://github.com/bmaglass" target="_blank" rel="noopener noreferrer">
                <GitBranch className="h-4 w-4 mr-1.5" />
                GitHub
              </a>
            </Button>
            <Button size="sm">
              <Terminal className="h-4 w-4 mr-1.5" />
              REST API Docs
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
