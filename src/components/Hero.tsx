
import { useEffect, useRef } from 'react';

const Hero = () => {
  const heroRef = useRef<HTMLDivElement>(null);
  
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!heroRef.current) return;
      
      const { clientX, clientY } = e;
      const { width, height, left, top } = heroRef.current.getBoundingClientRect();
      
      const x = (clientX - left) / width - 0.5;
      const y = (clientY - top) / height - 0.5;
      
      const moveX = x * 20;
      const moveY = y * 10;
      
      const productImage = heroRef.current.querySelector('.product-image') as HTMLElement;
      const bgGradient = heroRef.current.querySelector('.bg-gradient') as HTMLElement;
      
      if (productImage && bgGradient) {
        productImage.style.transform = `translate(${moveX * -1}px, ${moveY * -1}px)`;
        bgGradient.style.transform = `translate(${moveX * 0.5}px, ${moveY * 0.5}px)`;
      }
    };
    
    document.addEventListener('mousemove', handleMouseMove);
    
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
    };
  }, []);

  return (
    <section 
      ref={heroRef}
      className="min-h-screen flex items-center justify-center pt-20 relative overflow-hidden"
      id="hero"
    >
      {/* Background elements */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="bg-gradient absolute w-[80%] h-[60%] top-1/3 left-1/2 transform -translate-x-1/2 -translate-y-1/2 rounded-full opacity-20 blur-3xl bg-gradient-to-r from-blue-100 to-purple-100 transition-transform duration-700 ease-apple-ease"></div>
      </div>
      
      <div className="max-w-7xl mx-auto px-4 sm:px-6 w-full grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-0 items-center z-10">
        <div className="lg:pr-10 max-w-2xl">
          <span className="inline-block px-3 py-1 rounded-full bg-secondary text-sm font-medium text-secondary-foreground mb-6 animate-fadeIn animate-delay-1">
            Introducing Essence
          </span>
          <h1 className="heading-1 mb-6 animate-fadeInUp animate-delay-2">
            Simplicity is the<br />ultimate sophistication
          </h1>
          <p className="body-text mb-8 animate-fadeInUp animate-delay-3">
            Experience design that's intuitive, elegant, and purposeful. Every detail considered, every interaction refined, every moment memorable.
          </p>
          <div className="flex flex-wrap gap-4 animate-fadeInUp animate-delay-4">
            <button className="button-primary">
              Discover More
            </button>
            <button className="button-secondary">
              Learn Features
            </button>
          </div>
        </div>
        
        <div className="relative h-[500px] lg:h-[600px] flex items-center justify-center">
          <div className="absolute w-80 h-80 bg-gradient-radial from-blue-50 to-transparent opacity-70 blur-2xl rounded-full animate-float"></div>
          <div className="relative z-10 transition-transform duration-700 ease-apple-ease product-image animate-scaleIn animate-delay-3">
            <img 
              src="https://images.unsplash.com/photo-1563013544-824ae1b704d3?ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D&auto=format&fit=crop&w=2070&q=80" 
              alt="Minimal product design" 
              className="w-[400px] h-auto object-contain drop-shadow-2xl"
            />
          </div>
        </div>
      </div>
      
      {/* Scroll indicator */}
      <div className="absolute bottom-10 left-1/2 transform -translate-x-1/2 animate-fadeIn animate-delay-5">
        <div className="w-8 h-12 rounded-full border-2 border-foreground/20 flex items-start justify-center p-2">
          <div className="w-1 h-2 bg-foreground/60 rounded-full animate-float"></div>
        </div>
      </div>
    </section>
  );
};

export default Hero;
