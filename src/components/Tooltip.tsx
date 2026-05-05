import React from 'react';

interface TooltipProps {
  content: React.ReactNode;
  children: React.ReactNode;
}

export function Tooltip({ content, children }: TooltipProps) {
  return (
    <div className="tooltip-wrap">
      {children}
      <div className="tooltip-panel" role="tooltip">
        {content}
      </div>
    </div>
  );
}
