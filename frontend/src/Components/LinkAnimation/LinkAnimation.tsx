import React from 'react';
import { motion } from 'framer-motion';
import { FaLink, FaUnlink } from 'react-icons/fa';
import '../PotentialMatch/PotentialMatch.css'

/**
 * LinkAnimation Components - Framer Animation that links the matches when they are attached.
 * @prop {boolean} isBroken - Boolean to check if the link animation is true or false.
 * @prop {string} className - Optional class name for styling the component.
 **/

interface LinkAnimationProps {
  isBroken: boolean; 
  className?: string;
}

/**
 * LinkAnimation component renders a framer-motion animation for linking or breaking links between matches.
 * @param {LinkAnimationProps} props - The props for the component.
 * @returns {React.ReactElement} The animated link icon.
 */
const LinkAnimation: React.FC<LinkAnimationProps> = ({ isBroken, className }) => (
  <div className={className}>
    <motion.div
      initial={{ scale: 0.8, opacity: 0 }}
      animate={{
        scale: 1,
        opacity: 1,
        rotate: isBroken ? 0 : 360,
      }}
      whileHover={{ scale: 1.1 }}
      transition={{
        type: 'spring',
        stiffness: 260,
        damping: 20,
        duration: 0.6,
      }}
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {isBroken ? (
        <FaUnlink size="80%" color="var(--color-accent)" />
      ) : (
        <FaLink size="80%" color="var(--color-accent)" />
      )}
    </motion.div>
  </div>
);

export default LinkAnimation;