import { useState } from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { Mail, Phone, MapPin } from 'lucide-react';
import { useContactForm } from '@/hooks/useContactForm';
import { FadeIn, StaggerChildren, StaggerItem, MotionCard } from '@/components/animations';

const Contact = () => {
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const { subscribeToNewsletter, isSubmitting } = useContactForm();
  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Validate email using zod
    const { newsletterSchema } = await import('@/lib/validation');
    const result = newsletterSchema.safeParse({ email: email.trim() });
    
    if (!result.success) {
      return;
    }
    
    const success = await subscribeToNewsletter(result.data.email);
    if (success) {
      setSubmitted(true);
      setEmail('');
      
      setTimeout(() => {
        setSubmitted(false);
      }, 3000);
    }
  };

  const contactInfo = [
    {
      title: 'Visit Our Office',
      icon: MapPin,
      content: <>Cairo Road, Lusaka<br />Zambia</>,
    },
    {
      title: 'Email Mr. Banda',
      icon: Mail,
      content: <>mabvuto@bmaglasspay.com<br />support@bmaglasspay.com</>,
    },
    {
      title: 'Call Us',
      icon: Phone,
      content: <>+260 976 123 456<br />Mon-Fri, 8:30am-5pm CAT</>,
    },
  ];

  return (
    <section id="contact" className="section">
      <FadeIn duration={0.7} distance={24}>
        <div className="max-w-4xl mx-auto">
          <MotionCard 
            className="glass rounded-2xl p-10 md:p-16 relative overflow-hidden"
            hoverScale={1}
            hoverLift={0}
          >
            {/* Background decoration */}
            <div className="absolute -top-24 -right-24 w-48 h-48 bg-primary/5 rounded-full blur-2xl"></div>
            <div className="absolute -bottom-24 -left-24 w-48 h-48 bg-primary/5 rounded-full blur-2xl"></div>
            
            <div className="relative z-10">
              <h2 className="heading-2 mb-4 text-center">
                Stay Connected
              </h2>
              <p className="body-text text-center mb-8">
                Subscribe to receive updates on BMaGlass Pay's new features, payment solutions, and financial insights for Zambian businesses.
              </p>
              
              <form onSubmit={handleSubmit} className="max-w-md mx-auto">
                <div className="flex flex-col sm:flex-row gap-3">
                  <motion.input
                    type="email"
                    placeholder="Your email address"
                    className="flex-1 px-4 py-3 rounded-full border border-border focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all duration-300 bg-background"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    whileFocus={{ scale: 1.01 }}
                    transition={{ type: 'spring', stiffness: 300 }}
                  />
                  <motion.button 
                    type="submit"
                    className={cn(
                      "button-primary whitespace-nowrap transition-all duration-500 ease-apple-ease overflow-hidden",
                      submitted && "bg-primary/80"
                    )}
                    disabled={isSubmitting}
                    whileHover={{ scale: 1.03 }}
                    whileTap={{ scale: 0.98 }}
                    transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                  >
                    {submitted ? "Thank You!" : isSubmitting ? "Subscribing..." : "Subscribe"}
                  </motion.button>
                </div>
              </form>
              
              <StaggerChildren 
                className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-8"
                staggerDelay={0.1}
                initialDelay={0.2}
              >
                {contactInfo.map((info) => (
                  <StaggerItem key={info.title}>
                    <MotionCard 
                      className="flex flex-col items-center md:items-start p-4 rounded-xl"
                      hoverScale={1.02}
                      hoverLift={-2}
                    >
                      <h4 className="text-lg font-medium mb-2">{info.title}</h4>
                      <div className="flex items-center text-foreground/70">
                        <info.icon className="h-5 w-5 mr-2 text-primary" />
                        <p>{info.content}</p>
                      </div>
                    </MotionCard>
                  </StaggerItem>
                ))}
              </StaggerChildren>
            </div>
          </MotionCard>
        </div>
      </FadeIn>
    </section>
  );
};

export default Contact;
