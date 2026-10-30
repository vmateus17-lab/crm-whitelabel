import { useEffect, useState, useRef } from "react";

interface AnimatedNumberProps {
  value: number;
  duration?: number;
  formatter?: (val: number) => string;
  className?: string;
}

/**
 * Componente que exibe números e valores monetários com uma transição suave e animada (count-up).
 */
export function AnimatedNumber({
  value,
  duration = 900,
  formatter,
  className,
}: AnimatedNumberProps) {
  const [displayValue, setDisplayValue] = useState(0);
  const prevValueRef = useRef(0);
  const isMountedRef = useRef(false);

  useEffect(() => {
    const startValue = isMountedRef.current ? prevValueRef.current : 0;
    const endValue = Number(value) || 0;
    isMountedRef.current = true;

    if (startValue === endValue) {
      setDisplayValue(endValue);
      return;
    }

    let animationFrameId: number;
    let startTime: number | null = null;

    const animate = (timestamp: number) => {
      if (!startTime) startTime = timestamp;
      const elapsed = timestamp - startTime;
      const progress = Math.min(elapsed / duration, 1);

      // Curva de desaceleração suave (easeOutCubic)
      const easeOut = 1 - Math.pow(1 - progress, 3);
      const current = startValue + (endValue - startValue) * easeOut;

      setDisplayValue(current);

      if (progress < 1) {
        animationFrameId = requestAnimationFrame(animate);
      } else {
        setDisplayValue(endValue);
        prevValueRef.current = endValue;
      }
    };

    animationFrameId = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [value, duration]);

  const output = formatter
    ? formatter(displayValue)
    : Math.round(displayValue).toLocaleString("pt-BR");

  return <span className={className}>{output}</span>;
}
