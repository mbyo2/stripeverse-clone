
import { useState, useRef, useEffect } from 'react';
import { cn } from '@/lib/utils';

const Contact = () => {
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const contactRef = useRef<HTMLDivElement>(null);
  
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (email.trim() !== '') {
      // In a real app, you'd send this to your backend
      console.log('Subscription email:', email);
      setSubmitted(true);
      setEmail('');
      
      // Reset status after 3 seconds
      setTimeout(() => {
        setSubmitted(false);
      }, 3000);
    }
  };
  
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          contactRef.current?.classList.add('animate-fadeInUp');
          observer.unobserve(entries[0].target);
        }
      },
      { threshold: 0.1 }
    );
    
    if (contactRef.current) {
      observer.observe(contactRef.current);
    }
    
    return () => {
      if (contactRef.current) {
        observer.unobserve(contactRef.current);
      }
    };
  }, []);

  return (
    <section id="contact" className="section">
      <div 
        ref={contactRef}
        className="max-w-4xl mx-auto opacity-0"
      >
        <div className="glass rounded-2xl p-10 md:p-16 relative overflow-hidden">
          {/* Background decoration */}
          <div className="absolute -top-24 -right-24 w-48 h-48 bg-primary/5 rounded-full blur-2xl"></div>
          <div className="absolute -bottom-24 -left-24 w-48 h-48 bg-primary/5 rounded-full blur-2xl"></div>
          
          <div className="relative z-10">
            <h2 className="heading-2 mb-4 text-center">
              Stay Connected
            </h2>
            <p className="body-text text-center mb-8">
              Join our newsletter to receive updates on new products, special offers, and design insights.
            </p>
            
            <form onSubmit={handleSubmit} className="max-w-md mx-auto">
              <div className="flex flex-col sm:flex-row gap-3">
                <input
                  type="email"
                  placeholder="Your email address"
                  className="flex-1 px-4 py-3 rounded-full border border-border focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all duration-300"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
                <button 
                  type="submit"
                  className={cn(
                    "button-primary whitespace-nowrap transition-all duration-500 ease-apple-ease overflow-hidden",
                    submitted && "bg-green-500"
                  )}
                >
                  {submitted ? "Thank You!" : "Subscribe"}
                </button>
              </div>
            </form>
            
            <div className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-8 text-center">
              <div>
                <h4 className="text-lg font-medium mb-2">Visit Us</h4>
                <p className="text-foreground/70">123 Design Street<br />San Francisco, CA 94107</p>
              </div>
              <div>
                <h4 className="text-lg font-medium mb-2">Email Us</h4>
                <p className="text-foreground/70">hello@essence.design<br />support@essence.design</p>
              </div>
              <div>
                <h4 className="text-lg font-medium mb-2">Call Us</h4>
                <p className="text-foreground/70">+1 (555) 123-4567<br />Mon-Fri, 9am-5pm PST</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default Contact;
