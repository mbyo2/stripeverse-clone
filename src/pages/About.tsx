
import React from "react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";

const About = () => {
  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 pt-24 pb-16 px-4 max-w-4xl mx-auto w-full">
        <h1 className="text-3xl font-bold mb-6">About BMaGlass Pay</h1>
        
        <div className="prose max-w-none">
          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-4">Our Mission</h2>
            <p className="mb-4">
              At BMaGlass Pay, our mission is to provide secure, reliable, and accessible payment solutions for individuals and businesses across Zambia and beyond. We believe that financial inclusion is a right, not a privilege, and we're committed to breaking down barriers to digital payments.
            </p>
          </section>
          
          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-4">Our Story</h2>
            <p className="mb-4">
              Founded in 2023, BMaGlass Pay emerged from a recognition of the challenges facing the payment ecosystem in Africa. Our founders, with backgrounds in fintech and telecommunications, set out to create a platform that would bridge the gap between traditional banking, mobile money, and emerging payment technologies.
            </p>
            <p>
              Today, we're proud to be one of the fastest-growing payment providers in Zambia, with a commitment to innovation, security, and customer satisfaction.
            </p>
          </section>
          
          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-4">Our Values</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="bg-secondary/10 p-6 rounded-lg">
                <h3 className="font-semibold mb-2">Security</h3>
                <p>We maintain the highest standards of security, with PCI DSS compliance and robust encryption to protect customer data and transactions.</p>
              </div>
              <div className="bg-secondary/10 p-6 rounded-lg">
                <h3 className="font-semibold mb-2">Accessibility</h3>
                <p>We design our solutions to be accessible to everyone, regardless of technical expertise or device capability.</p>
              </div>
              <div className="bg-secondary/10 p-6 rounded-lg">
                <h3 className="font-semibold mb-2">Innovation</h3>
                <p>We continuously explore new technologies and approaches to improve payment experiences and solve emerging challenges.</p>
              </div>
              <div className="bg-secondary/10 p-6 rounded-lg">
                <h3 className="font-semibold mb-2">Transparency</h3>
                <p>We believe in clear, honest communication with our customers about fees, services, and policies.</p>
              </div>
            </div>
          </section>
          
          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-4">Regulatory Compliance</h2>
            <p className="mb-4">
              BMaGlass Pay is fully licensed by the Bank of Zambia and complies with all relevant financial regulations. We're committed to maintaining the highest standards of compliance and ethical business practices.
            </p>
            <div className="flex flex-wrap gap-4 mt-6">
              <div className="border rounded-md px-4 py-2 bg-secondary/5 flex items-center">
                <span className="font-medium">PCI DSS Compliant</span>
              </div>
              <div className="border rounded-md px-4 py-2 bg-secondary/5 flex items-center">
                <span className="font-medium">Bank of Zambia Approved</span>
              </div>
              <div className="border rounded-md px-4 py-2 bg-secondary/5 flex items-center">
                <span className="font-medium">AML Compliant</span>
              </div>
            </div>
          </section>
          
          <section>
            <h2 className="text-xl font-semibold mb-4">Our Team</h2>
            <p className="mb-4">
              Our team brings together expertise from fintech, banking, telecommunications, and customer service. We're a diverse group united by a passion for financial inclusion and technological innovation.
            </p>
            <p>
              Interested in joining our team? Check out our <a href="/careers" className="text-primary hover:underline">careers page</a> for current opportunities.
            </p>
          </section>
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default About;
