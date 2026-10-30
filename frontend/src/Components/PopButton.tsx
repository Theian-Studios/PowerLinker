import React from 'react';
import { motion } from 'framer-motion';
//import { label } from "framer-motion/m";

/**
 * Props for the PopButton component.
 * @interface PopButtonProps
 * @property {("button" | "submit" | "reset")} [type] - Specifies the HTML button type for form submission behavior.
 * @property {string} [className] - Custom CSS classes to apply to the button element.
 * @property {() => void} [onClick] - Event handler function triggered when the button is clicked.
 * @property {string} label - Text content displayed on the button surface.
 * @property {boolean} [disabled] - Controls whether the button can be interacted with.
 */
interface PopButtonProps {
  type?: "button" | "submit" | "reset";
  className?: string; 
  onClick?: () => void;
  label: string;
  disabled?: boolean;
}

/**
 * PopButton Component - A button with animation effects on hover and click.
 * @param {PopButtonProps} props - The component props.
 * @returns {React.ReactElement} A button component with animation effects.
 */
const PopButton: React.FC<PopButtonProps> = ({ type, className, onClick, label, disabled }) => {
  return (
    <motion.button
      type={type}
      className={className} 
      onClick={disabled ? undefined : onClick} 
      whileHover={disabled ? {} : { scale: 1.02 }} 
      whileTap={disabled ? {} : { scale: 0.98 }} 
      transition={{ type: 'spring', stiffness: 300 }}
      disabled={disabled}
    >
      {label}
    </motion.button>
  );
};

export default PopButton;