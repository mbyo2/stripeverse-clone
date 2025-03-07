
import { useRef, useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

const products = [
  {
    id: 1,
    name: "The Minimalist Collection",
    description: "Elevate your everyday with our minimalist collection, where form meets function in perfect harmony.",
    image: "https://images.unsplash.com/photo-1618220179428-22790b461013?ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D&auto=format&fit=crop&w=1780&q=80"
  },
  {
    id: 2,
    name: "Essence Studio",
    description: "Experience sound as the artist intended with our meticulously engineered audio products.",
    image: "https://images.unsplash.com/photo-1612095515920-96ac62cb828a?ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D&auto=format&fit=crop&w=1742&q=80"
  },
  {
    id: 3,
    name: "Purity Series",
    description: "Clean lines and pure materials create our most refined collection yet.",
    image: "https://images.unsplash.com/photo-1613156684806-ede8b0af1ebe?ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D&auto=format&fit=crop&w=1743&q=80"
  }
];

const Products = () => {
  const [activeProduct, setActiveProduct] = useState(0);
  const productsRef = useRef<HTMLDivElement>(null);
  
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          productsRef.current?.classList.add('animate-fadeInUp');
          observer.unobserve(entries[0].target);
        }
      },
      { threshold: 0.1 }
    );
    
    if (productsRef.current) {
      observer.observe(productsRef.current);
    }
    
    return () => {
      if (productsRef.current) {
        observer.unobserve(productsRef.current);
      }
    };
  }, []);
  
  useEffect(() => {
    const interval = setInterval(() => {
      setActiveProduct((prev) => (prev + 1) % products.length);
    }, 5000);
    
    return () => clearInterval(interval);
  }, []);

  return (
    <section id="products" className="section bg-secondary/50">
      <div className="text-center mb-16">
        <span className="inline-block px-3 py-1 rounded-full bg-white text-sm font-medium text-foreground mb-4">
          Our Products
        </span>
        <h2 className="heading-2 mb-4">
          Beautifully Crafted
        </h2>
        <p className="body-text max-w-2xl mx-auto">
          Each product is designed with intention and purpose, creating a cohesive experience that reflects our commitment to quality.
        </p>
      </div>
      
      <div 
        ref={productsRef}
        className="relative h-[600px] opacity-0"
      >
        <div className="absolute inset-0 flex items-center justify-center">
          {products.map((product, index) => (
            <div 
              key={product.id}
              className={cn(
                "absolute inset-0 flex flex-col md:flex-row items-center gap-8 transition-all duration-1000 ease-apple-ease",
                activeProduct === index 
                  ? "opacity-100 translate-x-0 z-10" 
                  : "opacity-0 translate-x-[100px] z-0"
              )}
            >
              <div className="w-full md:w-1/2 md:pr-8">
                <div className="relative overflow-hidden rounded-2xl group">
                  <div className="absolute inset-0 bg-black/10 group-hover:bg-black/0 transition-all duration-500 ease-apple-ease"></div>
                  <img 
                    src={product.image} 
                    alt={product.name} 
                    className="w-full h-[300px] md:h-[400px] object-cover transition-transform duration-700 ease-apple-ease group-hover:scale-105"
                    loading="lazy"
                  />
                </div>
              </div>
              <div className="w-full md:w-1/2 text-left">
                <h3 className="heading-3 mb-4">{product.name}</h3>
                <p className="body-text mb-6">{product.description}</p>
                <button className="button-primary mb-8">
                  Explore {product.name}
                </button>
                
                <div className="flex items-center justify-start space-x-3">
                  {products.map((_, i) => (
                    <button 
                      key={i}
                      className={cn(
                        "w-12 h-1.5 rounded-full transition-all duration-300 ease-apple-ease",
                        activeProduct === i ? "bg-primary" : "bg-primary/30"
                      )}
                      onClick={() => setActiveProduct(i)}
                    />
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default Products;
