import React from 'react';
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import SecurityDashboard from "@/components/SecurityDashboard";

const SecuritySettings = () => {
  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-blue-50 to-purple-50">
      <Header />
      <main className="flex-1 pt-24 pb-16 px-4 max-w-7xl mx-auto w-full">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">Security Settings</h1>
          <p className="text-muted-foreground">
            Monitor your account security and manage access controls
          </p>
        </div>
        <SecurityDashboard />
      </main>
      <Footer />
    </div>
  );
};

export default SecuritySettings;