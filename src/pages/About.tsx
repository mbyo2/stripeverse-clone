
import React from "react";
import { Link } from "react-router-dom";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { Card, CardContent } from "@/components/ui/card";
import { Shield, Users, Lightbulb, Eye, MapPin, Award, Building2 } from "lucide-react";

const About = () => {
  const values = [
    { icon: Shield, title: "Security", description: "PCI DSS compliance and bank-level encryption protect every transaction and customer data point." },
    { icon: Users, title: "Accessibility", description: "Solutions designed for everyone — from smartphone users to USSD on feature phones." },
    { icon: Lightbulb, title: "Innovation", description: "Continuously pushing boundaries with mobile money, virtual cards, Bitcoin, and API-first architecture." },
    { icon: Eye, title: "Transparency", description: "Clear, honest communication about fees, policies, and how we handle your data." },
  ];

  const stats = [
    { value: "10K+", label: "Active Users" },
    { value: "K50M+", label: "Processed Monthly" },
    { value: "99.9%", label: "Uptime" },
    { value: "24/7", label: "Support" },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1 pt-24 pb-16 px-4 max-w-5xl mx-auto w-full">
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold mb-4">About BMaGlass Pay</h1>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            Zambia's trusted payment gateway — making digital payments secure, accessible, and instant for everyone.
          </p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-12">
          {stats.map((stat) => (
            <Card key={stat.label}>
              <CardContent className="p-6 text-center">
                <div className="text-3xl font-bold text-primary mb-1">{stat.value}</div>
                <div className="text-sm text-muted-foreground">{stat.label}</div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Mission */}
        <section className="mb-12">
          <h2 className="text-2xl font-semibold mb-4">Our Mission</h2>
          <p className="text-muted-foreground leading-relaxed">
            At BMaGlass Pay, we believe financial inclusion is a right, not a privilege. Our mission is to provide secure, reliable, and accessible payment solutions for individuals and businesses across Zambia and beyond — bridging the gap between traditional banking, mobile money, and emerging payment technologies.
          </p>
        </section>

        {/* Story */}
        <section className="mb-12">
          <h2 className="text-2xl font-semibold mb-4">Our Story</h2>
          <p className="text-muted-foreground leading-relaxed mb-4">
            Founded in 2023 by Mabvuto Banda in Lusaka, BMaGlass Pay emerged from a recognition of the challenges facing the payment ecosystem in Africa. With backgrounds in fintech and telecommunications, our founding team set out to create a platform that works for everyone — from urban merchants processing card payments to rural users transacting via USSD.
          </p>
          <p className="text-muted-foreground leading-relaxed">
            Today, we're one of the fastest-growing payment providers in Zambia, processing millions of Kwacha monthly and serving thousands of businesses and individuals with a commitment to innovation, security, and customer satisfaction.
          </p>
        </section>

        {/* Values */}
        <section className="mb-12">
          <h2 className="text-2xl font-semibold mb-6">Our Values</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {values.map((value) => (
              <Card key={value.title}>
                <CardContent className="p-6 flex gap-4">
                  <div className="p-2 rounded-lg bg-primary/10 h-fit">
                    <value.icon className="h-6 w-6 text-primary" />
                  </div>
                  <div>
                    <h3 className="font-semibold mb-1">{value.title}</h3>
                    <p className="text-sm text-muted-foreground">{value.description}</p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        {/* Compliance */}
        <section className="mb-12">
          <h2 className="text-2xl font-semibold mb-4">Regulatory Compliance</h2>
          <p className="text-muted-foreground mb-6">
            BMaGlass Pay is fully licensed and complies with all relevant financial regulations in Zambia.
          </p>
          <div className="flex flex-wrap gap-3">
            {[
              { icon: Shield, label: "PCI DSS Compliant" },
              { icon: Building2, label: "Bank of Zambia Approved" },
              { icon: Award, label: "AML/KYC Compliant" },
            ].map((badge) => (
              <div key={badge.label} className="flex items-center gap-2 px-4 py-2 rounded-lg border bg-card">
                <badge.icon className="h-4 w-4 text-primary" />
                <span className="text-sm font-medium">{badge.label}</span>
              </div>
            ))}
          </div>
        </section>

        {/* Team */}
        <section className="mb-12">
          <h2 className="text-2xl font-semibold mb-4">Our Team</h2>
          <p className="text-muted-foreground mb-4">
            Our team brings together expertise from fintech, banking, telecommunications, and customer service. We're a diverse group united by a passion for financial inclusion and technological innovation.
          </p>
          <p className="text-muted-foreground">
            Interested in joining? Reach out via our{' '}
            <Link to="/contact" className="text-primary hover:underline">contact page</Link>.
          </p>
        </section>

        {/* Location */}
        <section>
          <Card>
            <CardContent className="p-6 flex items-center gap-4">
              <MapPin className="h-6 w-6 text-primary" />
              <div>
                <h3 className="font-semibold">Headquarters</h3>
                <p className="text-sm text-muted-foreground">Cairo Road, Lusaka, Zambia</p>
              </div>
            </CardContent>
          </Card>
        </section>
      </main>
      <Footer />
    </div>
  );
};

export default About;
