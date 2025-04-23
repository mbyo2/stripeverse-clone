
import { useLocation } from "react-router-dom";
import { useEffect } from "react";
import { Link } from "react-router-dom";

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    console.error(
      "404 Error: User attempted to access non-existent route:",
      location.pathname
    );
  }, [location.pathname]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-hero-pattern">
      <div className="text-center p-8 rounded-2xl bg-white/80 backdrop-blur-sm border border-gray-100 shadow-xl">
        <h1 className="text-6xl font-bold mb-4 bg-gradient-to-r from-theme-blue via-theme-purple to-theme-green bg-clip-text text-transparent">404</h1>
        <p className="text-xl text-gray-600 mb-6">Oops! Page not found</p>
        <Link 
          to="/" 
          className="inline-flex items-center px-6 py-3 rounded-full bg-gradient-to-r from-theme-blue to-theme-purple text-white hover:opacity-90 transition-opacity duration-300"
        >
          Return to Home
        </Link>
      </div>
    </div>
  );
};

export default NotFound;
