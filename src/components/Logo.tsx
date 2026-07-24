import React from 'react';
import { Droplets } from 'lucide-react';

interface LogoProps {
  size?: 'sm' | 'md' | 'lg';
  light?: boolean;
}

export default function Logo({ size = 'md', light = false }: LogoProps) {
  const sizes = {
    sm: { icon: 20, text: 'text-xl' },
    md: { icon: 28, text: 'text-2xl' },
    lg: { icon: 40, text: 'text-4xl' },
  };

  return (
    <div className="flex items-center gap-2">
      <div className="relative">
        <Droplets
          size={sizes[size].icon}
          className={light ? 'text-white' : 'text-sky-500'}
          strokeWidth={2.5}
        />
      </div>
      <span
        className={`font-black tracking-tight ${sizes[size].text} ${
          light ? 'text-white' : 'text-slate-900'
        }`}
      >
        Wish<span className={light ? 'text-sky-300' : 'text-sky-500'}>Wash</span>
      </span>
    </div>
  );
}
