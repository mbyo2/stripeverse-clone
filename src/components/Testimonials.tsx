
import { useRef, useEffect } from 'react';
import { cn } from '@/lib/utils';

const testimonials = [
  {
    id: 1,
    name: "Sarah Johnson",
    role: "Creative Director",
    quote: "The attention to detail in these products is unmatched. Every interaction feels intentional and refined. It's elevated my daily experience in subtle but meaningful ways.",
    avatar: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?ixlib=rb-1.2.1&auto=format&fit=crop&w=256&q=80"
  },
  {
    id: 2,
    name: "Michael Chen",
    role: "Product Designer",
    quote: "As a designer myself, I'm incredibly impressed by the thoughtfulness behind every aspect of these products. They've managed to create something that's both beautiful and genuinely useful.",
    avatar: "https://images.unsplash.com/photo-1560250097-0b93528c311a?ixlib=rb-1.2.1&auto=format&fit=crop&w=256&q=80"
  },
  {
    id: 3,
    name: "Emily Rodriguez",
    role: "Architect",
    quote: "The minimalist approach speaks to me on a fundamental level. These products prove that when you remove the unnecessary, what remains can be truly exceptional.",
    avatar: "https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?ixlib=rb-1.2.1&auto=format&fit=crop&w=256&q=80"
  }
];

const Testimonials = () => {
  const testimonialsRef = useRef<HTMLDivElement>(null);
  
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry, index) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('animate-fadeInUp');
            entry.target.style.animationDelay = `${0.1 + index * 0.1}s`;
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.1 }
    );
    
    const testimonialElements = testimonialsRef.current?.querySelectorAll('.testimonial-card');
    testimonialElements?.forEach((el, index) => {
      observer.observe(el);
    });
    
    return () => {
      testimonialElements?.forEach((el) => {
        observer.unobserve(el);
      });
    };
  }, []);

  return (
    <section id="reviews" className="section">
      <div className="text-center mb-16">
        <span className="inline-block px-3 py-1 rounded-full bg-secondary text-sm font-medium text-secondary-foreground mb-4">
          What People Say
        </span>
        <h2 className="heading-2 mb-4">
          Trusted by Discerning Customers
        </h2>
        <p className="body-text max-w-2xl mx-auto">
          Our products are loved by people who appreciate the perfect balance of form and function.
        </p>
      </div>
      
      <div 
        ref={testimonialsRef}
        className="grid grid-cols-1 md:grid-cols-3 gap-8"
      >
        {testimonials.map((testimonial, index) => (
          <div 
            key={testimonial.id}
            className={cn(
              "testimonial-card opacity-0 p-8 rounded-2xl border border-border bg-white card-hover",
              index === 1 ? "md:translate-y-8" : ""
            )}
          >
            <div className="flex items-center mb-6">
              <div className="mr-4">
                <img 
                  src={testimonial.avatar} 
                  alt={testimonial.name}
                  className="w-12 h-12 rounded-full object-cover"
                  loading="lazy"
                />
              </div>
              <div>
                <h4 className="font-medium">{testimonial.name}</h4>
                <p className="text-sm text-foreground/60">{testimonial.role}</p>
              </div>
            </div>
            <blockquote className="text-foreground/80 relative pl-6 before:content-['"'] before:absolute before:top-0 before:left-0 before:text-4xl before:text-primary/20 before:font-serif before:leading-tight">
              {testimonial.quote}
            </blockquote>
          </div>
        ))}
      </div>
    </section>
  );
};

export default Testimonials;
