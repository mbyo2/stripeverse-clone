
import { useEffect, useRef } from 'react';

const features = [
  {
    title: "Intuitive Design",
    description: "Carefully crafted interfaces that feel natural and effortless to use, with thoughtful interactions at every step.",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
      </svg>
    )
  },
  {
    title: "Premium Materials",
    description: "Constructed with the finest materials that not only look beautiful but are built to last and improve with time.",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
      </svg>
    )
  },
  {
    title: "Minimalist Aesthetic",
    description: "Clean lines and intentional design choices that remove the unnecessary and emphasize what truly matters.",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" />
      </svg>
    )
  },
  {
    title: "Thoughtful Details",
    description: "Every element has been considered, from the subtle animations to the precise spacing that creates visual harmony.",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
      </svg>
    )
  }
];

const Features = () => {
  const featuresRef = useRef<HTMLDivElement>(null);
  
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('animate-fadeInUp');
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.1 }
    );
    
    const featureElements = featuresRef.current?.querySelectorAll('.feature-card');
    featureElements?.forEach((el) => {
      observer.observe(el);
    });
    
    return () => {
      featureElements?.forEach((el) => {
        observer.unobserve(el);
      });
    };
  }, []);

  return (
    <section id="features" className="section">
      <div className="text-center mb-16">
        <span className="inline-block px-3 py-1 rounded-full bg-secondary text-sm font-medium text-secondary-foreground mb-4">
          Features
        </span>
        <h2 className="heading-2 mb-4">
          Less, But Better
        </h2>
        <p className="body-text max-w-2xl mx-auto">
          We believe in the power of simplicity. By focusing on what truly matters, we create products that are more intuitive and meaningful.
        </p>
      </div>
      
      <div 
        ref={featuresRef}
        className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8"
      >
        {features.map((feature, index) => (
          <div 
            key={index} 
            className="feature-card opacity-0 p-6 rounded-xl border border-border bg-white hover:shadow-medium transition-all duration-500 ease-apple-ease"
            style={{ animationDelay: `${0.1 + index * 0.1}s` }}
          >
            <div className="feature-icon">
              {feature.icon}
            </div>
            <h3 className="text-xl font-medium mb-2">{feature.title}</h3>
            <p className="text-foreground/70">{feature.description}</p>
          </div>
        ))}
      </div>
    </section>
  );
};

export default Features;
