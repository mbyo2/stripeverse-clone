import { motion, HTMLMotionProps } from 'framer-motion';
import { forwardRef, ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface MotionButtonProps extends Omit<HTMLMotionProps<'button'>, 'children'> {
  children: ReactNode;
  className?: string;
  variant?: 'default' | 'subtle' | 'bounce';
}

const variants = {
  default: {
    whileHover: { scale: 1.02 },
    whileTap: { scale: 0.98 },
  },
  subtle: {
    whileHover: { scale: 1.01 },
    whileTap: { scale: 0.99 },
  },
  bounce: {
    whileHover: { scale: 1.03, y: -1 },
    whileTap: { scale: 0.97 },
  },
};

const MotionButton = forwardRef<HTMLButtonElement, MotionButtonProps>(
  ({ children, className, variant = 'default', ...props }, ref) => {
    const { whileHover, whileTap } = variants[variant];

    return (
      <motion.button
        ref={ref}
        className={cn(className)}
        whileHover={{
          ...whileHover,
          transition: {
            type: 'spring',
            stiffness: 400,
            damping: 25,
          },
        }}
        whileTap={{
          ...whileTap,
          transition: {
            type: 'spring',
            stiffness: 500,
            damping: 30,
          },
        }}
        {...props}
      >
        {children}
      </motion.button>
    );
  }
);

MotionButton.displayName = 'MotionButton';

export default MotionButton;
