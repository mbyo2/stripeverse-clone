
import React from "react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const Blog = () => {
  const blogPosts = [
    {
      id: 1,
      title: "The Future of Mobile Money in Zambia",
      excerpt: "As mobile money continues to grow in Zambia, what trends and innovations can we expect to see in the coming years?",
      date: "April 1, 2025",
      author: "Mulenga Chipimo",
      category: "Industry Trends",
      readTime: "5 min read"
    },
    {
      id: 2,
      title: "How Businesses Can Optimize Payment Processing",
      excerpt: "Learn key strategies to reduce payment processing costs and improve customer checkout experiences for your business.",
      date: "March 25, 2025",
      author: "Chanda Mwape",
      category: "Business Tips",
      readTime: "7 min read"
    },
    {
      id: 3,
      title: "Understanding PCI DSS Compliance for Small Businesses",
      excerpt: "A simplified guide to PCI DSS compliance requirements and how small businesses can meet these standards.",
      date: "March 18, 2025",
      author: "Bwalya Mutale",
      category: "Compliance",
      readTime: "6 min read"
    },
    {
      id: 4,
      title: "The Rise of USSD Payments in Rural Communities",
      excerpt: "How USSD technology is bringing digital payments to areas with limited smartphone access and internet connectivity.",
      date: "March 10, 2025",
      author: "Namwinga Tembo",
      category: "Financial Inclusion",
      readTime: "4 min read"
    },
    {
      id: 5,
      title: "Securing Your Digital Wallet: Best Practices",
      excerpt: "Essential security tips to protect your digital wallet from fraud and unauthorized access.",
      date: "March 5, 2025",
      author: "Chitalu Nkonde",
      category: "Security",
      readTime: "8 min read"
    },
    {
      id: 6,
      title: "Cross-Border Payments: Challenges and Solutions",
      excerpt: "A look at the current state of cross-border payments in Africa and innovative solutions on the horizon.",
      date: "February 28, 2025",
      author: "Mulenga Chipimo",
      category: "Industry Trends",
      readTime: "6 min read"
    }
  ];

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 pt-24 pb-16 px-4 max-w-6xl mx-auto w-full">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">BMaGlass Pay Blog</h1>
          <p className="text-muted-foreground">
            Insights, updates, and guides on payments, fintech, and financial inclusion
          </p>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {blogPosts.map((post) => (
            <Card key={post.id} className="flex flex-col h-full">
              <CardHeader className="pb-4">
                <div className="flex items-center justify-between mb-2">
                  <Badge variant="outline">{post.category}</Badge>
                  <span className="text-xs text-muted-foreground">{post.readTime}</span>
                </div>
                <CardTitle className="text-xl hover:text-primary cursor-pointer">
                  {post.title}
                </CardTitle>
              </CardHeader>
              <CardContent className="py-2 flex-grow">
                <p className="text-muted-foreground">{post.excerpt}</p>
              </CardContent>
              <CardFooter className="flex items-center justify-between pt-4 border-t">
                <div className="text-sm">
                  <span className="font-medium">{post.author}</span>
                </div>
                <div className="text-sm text-muted-foreground">{post.date}</div>
              </CardFooter>
            </Card>
          ))}
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default Blog;
