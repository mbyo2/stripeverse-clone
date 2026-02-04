import { motion, HTMLMotionProps } from 'framer-motion';
import { forwardRef, ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface MotionCardProps extends Omit<HTMLMotionProps<'div'>, 'children'> {
  children: ReactNode;
  className?: string;
  hoverScale?: number;
  hoverLift?: number;
}

const MotionCard = forwardRef<HTMLDivElement, MotionCardProps>(
  ({ children, className, hoverScale = 1.01, hoverLift = -2, ...props }, ref) => {
    return (
      <motion.div
        ref={ref}
        className={cn('transition-shadow', className)}
        whileHover={{
          scale: hoverScale,
          y: hoverLift,
          transition: {
            type: 'spring',
            stiffness: 300,
            damping: 25,
          },
        }}
        whileTap={{
          scale: 0.99,
          transition: {
            type: 'spring',
            stiffness: 400,
            damping: 25,
          },
        }}
        {...props}
      >
        {children}
      </motion.div>
    );
  }
);

MotionCard.displayName = 'MotionCard';

export default MotionCard;
